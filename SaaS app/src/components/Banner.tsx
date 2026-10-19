export function Banner({ error, notice }: { error?: string; notice?: string }) {
  return (
    <>
      {error && <div className="error">{error}</div>}
      {notice && <div className="notice">{notice}</div>}
    </>
  );
}
