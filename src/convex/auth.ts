import { convexAuth } from "@convex-dev/auth/server";
import { Anonymous } from "@convex-dev/auth/providers/Anonymous";
import { Password } from "@convex-dev/auth/providers/Password";
import { emailOtp } from "./auth/emailOtp";

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    Password({
      // Match the NChat signup form, which requires at least 6 characters.
      validatePasswordRequirements(password: string) {
        if (!password || password.length < 6) {
          throw new Error("Password must be at least 6 characters");
        }
      },
    }),
    emailOtp,
    Anonymous,
  ],
});
