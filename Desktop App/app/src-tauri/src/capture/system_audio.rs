//! System audio capture through ScreenCaptureKit (macOS 13+).
//!
//! This is the one thing a browser cannot do on macOS, and the reason this app is native at all: for a telehealth
//! visit it is how the patient's voice is recorded. The stream is configured for audio only, so no screen content is
//! ever captured even though the API is called ScreenCaptureKit. macOS still asks for Screen Recording permission,
//! because that is the permission governing one application listening to another.

use std::ffi::c_void;
use std::sync::{Arc, Mutex};

use objc2::rc::Retained;
use objc2::runtime::{AnyObject, ProtocolObject};
use objc2::{define_class, msg_send, AllocAnyThread, DefinedClass};
use objc2_foundation::{NSArray, NSError, NSObject, NSObjectProtocol};
use objc2_screen_capture_kit::{
    SCContentFilter, SCDisplay, SCShareableContent, SCStream, SCStreamConfiguration, SCStreamOutput,
    SCStreamOutputType, SCWindow,
};

use super::Channels;

/// Shared with the Objective-C callback below.
struct Sink {
    channels: Arc<Mutex<Channels>>,
}

define_class!(
    // The object ScreenCaptureKit hands buffers to. It implements SCStreamOutput and nothing else.
    #[unsafe(super(NSObject))]
    #[name = "PracticeAudioSink"]
    #[ivars = Sink]
    struct AudioSink;

    unsafe impl NSObjectProtocol for AudioSink {}

    unsafe impl SCStreamOutput for AudioSink {
        #[unsafe(method(stream:didOutputSampleBuffer:ofType:))]
        fn did_output(&self, _stream: &SCStream, buffer: &AnyObject, kind: SCStreamOutputType) {
            if kind != SCStreamOutputType::Audio {
                return;
            }
            // Nothing may unwind into ScreenCaptureKit's queue: a panic there aborts the whole app.
            let samples = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| pcm_from_sample_buffer(buffer)))
                .unwrap_or(None);
            if let Some(samples) = samples {
                if let Ok(mut c) = self.ivars().channels.lock() {
                    c.system.extend_from_slice(&samples);
                }
            }
        }
    }
);

extern "C" {
    fn CFGetTypeID(cf: *const c_void) -> usize;
    fn CMSampleBufferGetTypeID() -> usize;
}

/// True only when `buffer` really is a CMSampleBuffer. ScreenCaptureKit hands the handler a CoreFoundation object,
/// not an Objective-C one, so sending it Objective-C messages crashes ("unrecognized selector dataBuffer").
fn is_sample_buffer(buffer: *const c_void) -> bool {
    !buffer.is_null() && unsafe { CFGetTypeID(buffer) == CMSampleBufferGetTypeID() }
}

/// Pulls float samples out of a CMSampleBuffer with the CoreMedia C functions and converts them to the recorder's
/// 16 kHz mono. The stream is configured for one channel of 48 kHz float PCM, so the bytes are read as f32.
fn pcm_from_sample_buffer(buffer: &AnyObject) -> Option<Vec<i16>> {
    let raw = buffer as *const AnyObject as *const c_void;
    if !is_sample_buffer(raw) {
        static WARNED: std::sync::Once = std::sync::Once::new();
        WARNED.call_once(|| eprintln!("[system-audio] ignoring a buffer that is not a CMSampleBuffer"));
        return None;
    }
    unsafe {
        let sb = &*(raw as *const objc2_core_media::CMSampleBuffer);
        let block = sb.data_buffer()?;
        let mut ptr: *mut std::ffi::c_char = std::ptr::null_mut();
        let mut total: usize = 0;
        let status = block.data_pointer(0, std::ptr::null_mut(), &mut total, &mut ptr);
        if status != 0 || ptr.is_null() || total < 4 {
            return None;
        }
        let floats = std::slice::from_raw_parts(ptr as *const f32, total / 4);
        Some(super::to_mono_16k(floats, 1, 48_000))
    }
}

/// A running system-audio capture. Dropping it stops the stream.
pub struct Capture {
    stream: Retained<SCStream>,
}

impl Drop for Capture {
    fn drop(&mut self) {
        unsafe {
            let _: () = msg_send![&*self.stream, stopCaptureWithCompletionHandler: std::ptr::null::<c_void>()];
        }
    }
}

impl Capture {
    /// Starts capturing what the Mac is playing.
    ///
    /// The first call makes macOS ask for Screen Recording permission. Until the provider grants it this fails, and
    /// the caller carries on with the microphone alone rather than losing the visit.
    pub fn start(channels: Arc<Mutex<Channels>>) -> Result<Self, String> {
        unsafe {
            let content = shareable_content()?;
            let displays = content.displays();
            let display: Retained<SCDisplay> = displays
                .firstObject()
                .ok_or("this Mac reports no display, so system audio cannot be captured")?;

            // Audio only: the display as the filter with nothing excluded, and video at its smallest.
            let empty: Retained<NSArray<SCWindow>> = NSArray::new();
            let filter =
                SCContentFilter::initWithDisplay_excludingWindows(SCContentFilter::alloc(), &display, &empty);

            let config = SCStreamConfiguration::new();
            config.setCapturesAudio(true);
            config.setExcludesCurrentProcessAudio(true); // never record our own sound back into the visit
            config.setSampleRate(48_000);
            config.setChannelCount(1);
            config.setWidth(2);
            config.setHeight(2);

            let sink = AudioSink::alloc().set_ivars(Sink { channels });
            let sink: Retained<AudioSink> = msg_send![super(sink), init];

            let stream =
                SCStream::initWithFilter_configuration_delegate(SCStream::alloc(), &filter, &config, None);

            let output = ProtocolObject::<dyn SCStreamOutput>::from_ref(&*sink);
            let mut err: *mut NSError = std::ptr::null_mut();
            let added: bool = msg_send![
                &*stream,
                addStreamOutput: output,
                type: SCStreamOutputType::Audio,
                sampleHandlerQueue: std::ptr::null::<c_void>(),
                error: &mut err
            ];
            if !added {
                return Err("could not attach to the system audio".into());
            }
            // The stream retains the sink through addStreamOutput; this keeps Rust from dropping it first.
            std::mem::forget(sink);

            let _: () = msg_send![&*stream, startCaptureWithCompletionHandler: std::ptr::null::<c_void>()];
            Ok(Self { stream })
        }
    }
}

/// SCShareableContent is only available asynchronously; this waits for it, and a timeout is treated as permission
/// not having been granted, which is by far the usual cause.
fn shareable_content() -> Result<Retained<SCShareableContent>, String> {
    use std::sync::mpsc;
    let (tx, rx) = mpsc::channel();
    let tx = Mutex::new(Some(tx));

    let handler = block2::RcBlock::new(move |content: *mut SCShareableContent, _err: *mut NSError| {
        let found = if content.is_null() { None } else { unsafe { Retained::retain(content) } };
        if let Ok(mut guard) = tx.lock() {
            if let Some(sender) = guard.take() {
                let _ = sender.send(found);
            }
        }
    });

    unsafe {
        SCShareableContent::getShareableContentWithCompletionHandler(&handler);
    }
    match rx.recv_timeout(std::time::Duration::from_secs(10)) {
        Ok(Some(c)) => Ok(c),
        Ok(None) | Err(_) => Err("macOS did not allow system audio. Grant this app Screen Recording permission in \
             System Settings, under Privacy & Security, then record again."
            .into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    extern "C" {
        static kCFBooleanTrue: *const c_void;
    }

    #[test]
    fn type_guard_rejects_non_sample_buffers() {
        assert!(!is_sample_buffer(std::ptr::null()));
        // A real CoreFoundation object that is not a CMSampleBuffer (the shape of the crash on macOS 27).
        assert!(!is_sample_buffer(unsafe { kCFBooleanTrue }));
    }
}
