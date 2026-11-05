//! System audio through a Core Audio process tap (macOS 14.2+).
//!
//! A tap listens to what the Mac is playing without capturing the screen, so macOS asks only for "System Audio
//! Recording" permission and not for Screen Recording (and not for the "bypass the system picker" confirmation that
//! ScreenCaptureKit triggers). The tap is wrapped in a private aggregate device, which is how Core Audio lets an app
//! read a tap; an IOProc then receives the samples, which go to the recorder's 16 kHz mono "other party" channel.
//!
//! Nothing here logs audio. Only status codes are printed.

use std::ffi::{c_void, CStr};
use std::ptr::NonNull;
use std::sync::{Arc, Mutex};

use objc2::rc::Retained;
use objc2::runtime::AnyObject;
use objc2::AllocAnyThread;
use objc2_core_audio::{
    kAudioAggregateDeviceIsPrivateKey, kAudioAggregateDeviceIsStackedKey, kAudioAggregateDeviceMainSubDeviceKey,
    kAudioAggregateDeviceNameKey, kAudioAggregateDeviceSubDeviceListKey, kAudioAggregateDeviceTapAutoStartKey,
    kAudioAggregateDeviceTapListKey, kAudioAggregateDeviceUIDKey, kAudioDevicePropertyDeviceUID,
    kAudioTapPropertyFormat, AudioDeviceCreateIOProcID, AudioDeviceDestroyIOProcID, AudioDeviceIOProcID,
    AudioDeviceStart, AudioDeviceStop, AudioHardwareCreateAggregateDevice, AudioHardwareCreateProcessTap,
    AudioHardwareDestroyAggregateDevice, AudioHardwareDestroyProcessTap, AudioObjectGetPropertyData, CATapDescription,
};
use objc2_core_audio_types::{AudioBufferList, AudioStreamBasicDescription, AudioTimeStamp};
use objc2_foundation::{NSArray, NSDictionary, NSNumber, NSString, NSUUID};

use super::Channels;

const SYSTEM_OBJECT: u32 = 1;
const SEL_DEFAULT_OUTPUT: u32 = 0x644f_7574; // 'dOut'
const SCOPE_GLOBAL: u32 = 0x676c_6f62; // 'glob'

#[repr(C)]
struct PropAddr {
    selector: u32,
    scope: u32,
    element: u32,
}

/// What the IOProc needs. Leaked into the callback's client-data pointer and freed on drop.
struct Ctx {
    channels: Arc<Mutex<Channels>>,
    rate: u32,
}

pub struct Capture {
    tap: u32,
    aggregate: u32,
    proc_id: AudioDeviceIOProcID,
    ctx: *mut Ctx,
}

// The raw pointer is only touched by Core Audio's thread and by Drop, after the proc is destroyed.
unsafe impl Send for Capture {}

fn ns(s: &str) -> Retained<NSString> {
    NSString::from_str(s)
}

fn cstr(k: &CStr) -> Retained<NSString> {
    NSString::from_str(k.to_str().unwrap_or(""))
}

unsafe fn get_prop<T>(object: u32, selector: u32, scope: u32, out: &mut T) -> i32 {
    let addr = PropAddr { selector, scope, element: 0 };
    let mut size = std::mem::size_of::<T>() as u32;
    AudioObjectGetPropertyData(
        object,
        NonNull::new_unchecked(&addr as *const PropAddr as *mut _),
        0,
        std::ptr::null(),
        NonNull::new_unchecked(&mut size),
        NonNull::new_unchecked(out as *mut T as *mut c_void),
    )
}

unsafe fn default_output_uid() -> Option<Retained<NSString>> {
    let mut dev: u32 = 0;
    if get_prop(SYSTEM_OBJECT, SEL_DEFAULT_OUTPUT, SCOPE_GLOBAL, &mut dev) != 0 || dev == 0 {
        return None;
    }
    let mut uid: *mut NSString = std::ptr::null_mut();
    if get_prop(dev, kAudioDevicePropertyDeviceUID, SCOPE_GLOBAL, &mut uid) != 0 || uid.is_null() {
        return None;
    }
    Retained::from_raw(uid) // returned retained (a "Get" of a CFString property follows the create rule)
}

/// Turns a buffer list into the recorder's 16 kHz mono samples. Handles interleaved or planar float32.
unsafe fn convert(list: &AudioBufferList, rate: u32) -> Vec<i16> {
    let n = list.mNumberBuffers as usize;
    if n == 0 {
        return Vec::new();
    }
    let buffers = std::slice::from_raw_parts(list.mBuffers.as_ptr(), n);
    let first = &buffers[0];
    if first.mData.is_null() || first.mDataByteSize < 4 {
        return Vec::new();
    }
    let ch = first.mNumberChannels.max(1);
    if n == 1 {
        let f = std::slice::from_raw_parts(first.mData as *const f32, first.mDataByteSize as usize / 4);
        return super::to_mono_16k(f, ch as u16, rate);
    }
    // Planar: average the buffers into one mono stream.
    let len = buffers.iter().map(|b| b.mDataByteSize as usize / 4).min().unwrap_or(0);
    let mut mono = vec![0f32; len];
    for b in buffers {
        if b.mData.is_null() {
            continue;
        }
        let f = std::slice::from_raw_parts(b.mData as *const f32, len);
        for (m, s) in mono.iter_mut().zip(f) {
            *m += *s / n as f32;
        }
    }
    super::to_mono_16k(&mono, 1, rate)
}

unsafe extern "C-unwind" fn io_proc(
    _device: u32,
    _now: NonNull<AudioTimeStamp>,
    input: NonNull<AudioBufferList>,
    _in_time: NonNull<AudioTimeStamp>,
    _output: NonNull<AudioBufferList>,
    _out_time: NonNull<AudioTimeStamp>,
    client: *mut c_void,
) -> i32 {
    // Nothing may unwind into Core Audio's thread.
    let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let ctx = &*(client as *const Ctx);
        let samples = convert(input.as_ref(), ctx.rate);
        if !samples.is_empty() {
            if let Ok(mut c) = ctx.channels.lock() {
                c.system.extend_from_slice(&samples);
            }
        }
    }));
    0
}

impl Capture {
    /// Starts listening to what the Mac plays. The first call makes macOS ask for System Audio Recording permission;
    /// until it is granted the tap delivers silence, so the caller's "one-sided" check will say so.
    pub fn start(channels: Arc<Mutex<Channels>>) -> Result<Self, String> {
        unsafe {
            let exclude: Retained<NSArray<NSNumber>> = NSArray::new();
            let desc = CATapDescription::initMonoGlobalTapButExcludeProcesses(CATapDescription::alloc(), &exclude);
            desc.setPrivate(true);
            let tap_uuid = desc.UUID().UUIDString();

            let mut tap: u32 = 0;
            let st = AudioHardwareCreateProcessTap(Some(&desc), &mut tap);
            if st != 0 || tap == 0 {
                return Err(format!(
                    "could not listen to the system audio (code {st}). On macOS 14.2 or later, allow Practice Recorder \
                     under System Settings > Privacy & Security > System Audio Recording, then record again."
                ));
            }

            let mut asbd: AudioStreamBasicDescription = std::mem::zeroed();
            let fst = get_prop(tap, kAudioTapPropertyFormat, SCOPE_GLOBAL, &mut asbd);
            let (rate, chans) = if fst == 0 && asbd.mSampleRate > 0.0 {
                (asbd.mSampleRate as u32, asbd.mChannelsPerFrame.max(1))
            } else {
                (48_000, 1)
            };

            // Private aggregate device holding the tap (and the current output device as its clock).
            let agg_uid = NSUUID::new().UUIDString();
            let yes = NSNumber::new_i32(1);
            let no = NSNumber::new_i32(0);
            let drift = NSNumber::new_i32(1);
            let tap_entry = NSDictionary::from_slices(
                &[&*ns("uid"), &*ns("drift")],
                &[&*tap_uuid as &AnyObject, &*drift as &AnyObject],
            );
            let taps = NSArray::from_slice(&[&*tap_entry]);

            let out_uid = default_output_uid();
            let mut keys: Vec<Retained<NSString>> = vec![
                cstr(kAudioAggregateDeviceNameKey),
                cstr(kAudioAggregateDeviceUIDKey),
                cstr(kAudioAggregateDeviceIsPrivateKey),
                cstr(kAudioAggregateDeviceIsStackedKey),
                cstr(kAudioAggregateDeviceTapAutoStartKey),
                cstr(kAudioAggregateDeviceTapListKey),
            ];
            let name = ns("Practice Recorder tap");
            let mut vals: Vec<&AnyObject> =
                vec![&*name, &*agg_uid, &*yes, &*no, &*yes, &*taps];
            let sub;
            let sublist;
            if let Some(u) = out_uid.as_ref() {
                keys.push(cstr(kAudioAggregateDeviceMainSubDeviceKey));
                vals.push(&**u);
                sub = NSDictionary::from_slices(&[&*ns("uid")], &[&**u as &AnyObject]);
                sublist = NSArray::from_slice(&[&*sub]);
                keys.push(cstr(kAudioAggregateDeviceSubDeviceListKey));
                vals.push(&*sublist);
            }
            let key_refs: Vec<&NSString> = keys.iter().map(|k| &**k).collect();
            let dict = NSDictionary::from_slices(&key_refs, &vals);

            let mut aggregate: u32 = 0;
            let st = AudioHardwareCreateAggregateDevice(&*(&*dict as *const _ as *const _), NonNull::from(&mut aggregate));
            if st != 0 || aggregate == 0 {
                AudioHardwareDestroyProcessTap(tap);
                return Err(format!("could not set up system audio capture (code {st})."));
            }

            let ctx = Box::into_raw(Box::new(Ctx { channels, rate }));
            let mut proc_id: AudioDeviceIOProcID = None;
            let st = AudioDeviceCreateIOProcID(aggregate, Some(io_proc), ctx as *mut c_void, NonNull::from(&mut proc_id));
            if st != 0 {
                drop(Box::from_raw(ctx));
                AudioHardwareDestroyAggregateDevice(aggregate);
                AudioHardwareDestroyProcessTap(tap);
                return Err(format!("could not read the system audio (code {st})."));
            }
            let st = AudioDeviceStart(aggregate, proc_id);
            if st != 0 {
                AudioDeviceDestroyIOProcID(aggregate, proc_id);
                drop(Box::from_raw(ctx));
                AudioHardwareDestroyAggregateDevice(aggregate);
                AudioHardwareDestroyProcessTap(tap);
                return Err(format!("could not start the system audio capture (code {st})."));
            }
            eprintln!("[system-tap] started: {rate} Hz, {chans} ch");
            Ok(Self { tap, aggregate, proc_id, ctx })
        }
    }
}

impl Drop for Capture {
    fn drop(&mut self) {
        unsafe {
            AudioDeviceStop(self.aggregate, self.proc_id);
            AudioDeviceDestroyIOProcID(self.aggregate, self.proc_id);
            AudioHardwareDestroyAggregateDevice(self.aggregate);
            AudioHardwareDestroyProcessTap(self.tap);
            drop(Box::from_raw(self.ctx));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Live check, run by hand: `cargo test --lib live_tap -- --ignored --nocapture`. Play some audio while it runs.
    #[test]
    #[ignore]
    fn live_tap() {
        let channels = Arc::new(Mutex::new(Channels::default()));
        let cap = Capture::start(Arc::clone(&channels)).expect("tap should start");
        std::thread::sleep(std::time::Duration::from_secs(4));
        drop(cap);
        let c = channels.lock().unwrap();
        let peak = c.system.iter().map(|s| s.unsigned_abs()).max().unwrap_or(0);
        eprintln!("[live_tap] samples={} peak={}", c.system.len(), peak);
        assert!(!c.system.is_empty(), "the tap delivered no samples");
    }
}
