import { AppBackdrop } from "@/components/chat/AppBackdrop";
import { NChatLogo } from "@/components/chat/NChatLogo";
import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";
import { ArrowLeft } from "lucide-react";
import { Link } from "react-router";

export default function NotFound() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.5 }}
      className="relative flex min-h-screen flex-col"
    >
      <AppBackdrop />
      <div className="flex flex-1 items-center justify-center px-4">
        <div className="glass-strong flex w-full max-w-md flex-col items-center gap-4 rounded-3xl p-10 text-center shadow-2xl">
          <NChatLogo className="size-16" />
          <p className="text-6xl font-black tracking-tight text-primary/20">
            404
          </p>
          <div>
            <h1 className="text-xl font-bold tracking-tight">
              This page wandered off
            </h1>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              The conversation you're looking for doesn't exist — but your
              friends are still waiting back in the app.
            </p>
          </div>
          <Button asChild className="rounded-full bg-gradient-nchat text-white">
            <Link to="/">
              <ArrowLeft className="size-4" />
              Back to NChat
            </Link>
          </Button>
        </div>
      </div>
    </motion.div>
  );
}
