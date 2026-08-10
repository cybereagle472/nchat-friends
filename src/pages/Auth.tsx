import { AppBackdrop } from "@/components/chat/AppBackdrop";
import { NChatLogo, NChatWordmark } from "@/components/chat/NChatLogo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp";
import { useAuth } from "@/hooks/use-auth";
import { ArrowLeft, ArrowRight, Loader2, Mail, UserX } from "lucide-react";
import { Suspense, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";

interface AuthProps {
  redirectAfterAuth?: string;
}

function resolveRedirectAfterAuth(
  returnTo: string | null,
  fallback = "/chat",
) {
  if (returnTo?.startsWith("/") && !returnTo.startsWith("//")) {
    return returnTo;
  }
  return fallback;
}

function Auth({ redirectAfterAuth }: AuthProps = {}) {
  const { isLoading: authLoading, isAuthenticated, signIn } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const redirect = resolveRedirectAfterAuth(
    searchParams.get("returnTo"),
    redirectAfterAuth,
  );
  const [step, setStep] = useState<"signIn" | { email: string }>("signIn");
  const [otp, setOtp] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && isAuthenticated) {
      navigate(redirect);
    }
  }, [authLoading, isAuthenticated, navigate, redirect]);

  const handleEmailSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsLoading(true);
    setError(null);
    try {
      const formData = new FormData(event.currentTarget);
      await signIn("email-otp", formData);
      setStep({ email: formData.get("email") as string });
      setIsLoading(false);
    } catch (error) {
      console.error("Email sign-in error:", error);
      setError(
        error instanceof Error
          ? error.message
          : "Failed to send verification code. Please try again.",
      );
      setIsLoading(false);
    }
  };

  const handleOtpSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsLoading(true);
    setError(null);
    try {
      const formData = new FormData(event.currentTarget);
      await signIn("email-otp", formData);
      navigate(redirect);
    } catch (error) {
      console.error("OTP verification error:", error);
      setError("The verification code you entered is incorrect.");
      setIsLoading(false);
      setOtp("");
    }
  };

  const handleGuestLogin = async () => {
    setIsLoading(true);
    setError(null);
    try {
      await signIn("anonymous");
      navigate(redirect);
    } catch (error) {
      console.error("Guest login error:", error);
      setError(
        `Failed to sign in as guest: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      );
      setIsLoading(false);
    }
  };

  return (
    <div className="relative flex min-h-screen flex-col">
      <AppBackdrop />

      {/* Back to landing */}
      <header className="sticky top-0 z-40 px-4 pt-4">
        <button
          onClick={() => navigate("/")}
          className="glass-soft flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium text-muted-foreground transition hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Back to NChat
        </button>
      </header>

      {/* Auth Content */}
      <div className="flex flex-1 items-center justify-center px-4 py-10">
        <div className="w-full max-w-[400px]">
          <div className="glass-strong rounded-3xl p-8 shadow-2xl">
            <div className="mb-6 flex flex-col items-center text-center">
              <NChatLogo className="size-14" />
              <NChatWordmark className="mt-4" markClassName="size-7" />
            </div>

            {step === "signIn" ? (
              <>
                <div className="mb-5 text-center">
                  <h1 className="text-xl font-bold tracking-tight">
                    Welcome to NChat
                  </h1>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Sign in to start chatting with friends and family
                  </p>
                </div>
                <form onSubmit={handleEmailSubmit} className="space-y-3">
                  <div className="relative flex items-center gap-2">
                    <div className="relative flex-1">
                      <Mail className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        name="email"
                        placeholder="name@example.com"
                        type="email"
                        className="glass-soft h-11 rounded-2xl border-transparent pl-10"
                        disabled={isLoading}
                        required
                      />
                    </div>
                    <Button
                      type="submit"
                      variant="outline"
                      size="icon"
                      className="glass-soft h-11 w-11 rounded-2xl border-transparent"
                      disabled={isLoading}
                      aria-label="Send code"
                    >
                      {isLoading ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <ArrowRight className="size-4" />
                      )}
                    </Button>
                  </div>
                  {error && (
                    <p className="text-center text-sm text-destructive">{error}</p>
                  )}

                  <div className="relative py-2">
                    <div className="absolute inset-0 flex items-center">
                      <span className="w-full border-t border-white/60" />
                    </div>
                    <div className="relative flex justify-center text-xs uppercase">
                      <span className="glass-soft rounded-full px-3 py-0.5 text-muted-foreground">
                        Or
                      </span>
                    </div>
                  </div>

                  <Button
                    type="button"
                    variant="outline"
                    className="glass-soft h-11 w-full rounded-2xl border-transparent"
                    onClick={handleGuestLogin}
                    disabled={isLoading}
                  >
                    <UserX className="size-4" />
                    Continue as guest
                  </Button>
                </form>
              </>
            ) : (
              <>
                <div className="mb-5 text-center">
                  <h1 className="text-xl font-bold tracking-tight">
                    Check your email
                  </h1>
                  <p className="mt-1 text-sm text-muted-foreground">
                    We sent a code to{" "}
                    <span className="font-medium text-foreground">
                      {step.email}
                    </span>
                  </p>
                </div>
                <form onSubmit={handleOtpSubmit} className="space-y-4">
                  <input type="hidden" name="email" value={step.email} />
                  <input type="hidden" name="code" value={otp} />
                  <div className="flex justify-center">
                    <InputOTP
                      value={otp}
                      onChange={setOtp}
                      maxLength={6}
                      disabled={isLoading}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && otp.length === 6 && !isLoading) {
                          const form = (e.target as HTMLElement).closest("form");
                          if (form) form.requestSubmit();
                        }
                      }}
                    >
                      <InputOTPGroup>
                        {Array.from({ length: 6 }).map((_, index) => (
                          <InputOTPSlot key={index} index={index} />
                        ))}
                      </InputOTPGroup>
                    </InputOTP>
                  </div>
                  {error && (
                    <p className="text-center text-sm text-destructive">{error}</p>
                  )}
                  <p className="text-center text-sm text-muted-foreground">
                    Didn't receive a code?{" "}
                    <Button
                      variant="link"
                      className="h-auto p-0"
                      onClick={() => setStep("signIn")}
                    >
                      Try again
                    </Button>
                  </p>
                  <Button
                    type="submit"
                    className="h-11 w-full rounded-2xl bg-gradient-nchat text-white"
                    disabled={isLoading || otp.length !== 6}
                  >
                    {isLoading ? (
                      <>
                        <Loader2 className="size-4 animate-spin" />
                        Verifying…
                      </>
                    ) : (
                      <>
                        Verify code
                        <ArrowRight className="size-4" />
                      </>
                    )}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    className="w-full"
                    onClick={() => setStep("signIn")}
                    disabled={isLoading}
                  >
                    Use a different email
                  </Button>
                </form>
              </>
            )}
          </div>

          <p className="mt-4 text-center text-xs text-muted-foreground">
            Secured by{" "}
            <a
              href="https://freebuff.com"
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium underline-offset-2 hover:underline"
            >
              freebuff.com
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}

export default function AuthPage(props: AuthProps) {
  return (
    <Suspense>
      <Auth {...props} />
    </Suspense>
  );
}
