/** Bright, cool-toned gradient backdrop shared by all NChat surfaces. */
export function AppBackdrop() {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 -z-10 overflow-hidden"
    >
      <div
        className="orb -top-32 right-[-10%] h-[34rem] w-[34rem]"
        style={{
          background:
            "radial-gradient(circle, rgb(125 211 252 / 0.55), transparent 65%)",
        }}
      />
      <div
        className="orb top-[30%] left-[-14%] h-[30rem] w-[30rem]"
        style={{
          background:
            "radial-gradient(circle, rgb(196 181 253 / 0.5), transparent 65%)",
        }}
      />
      <div
        className="orb bottom-[-18%] left-[38%] h-[28rem] w-[28rem]"
        style={{
          background:
            "radial-gradient(circle, rgb(165 243 252 / 0.55), transparent 65%)",
        }}
      />
      <div
        className="orb top-[55%] right-[6%] h-[20rem] w-[20rem]"
        style={{
          background:
            "radial-gradient(circle, rgb(254 205 211 / 0.35), transparent 65%)",
        }}
      />
    </div>
  );
}
