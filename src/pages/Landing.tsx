import { AppBackdrop } from "@/components/chat/AppBackdrop";
import { NChatLogo, NChatWordmark } from "@/components/chat/NChatLogo";
import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";
import {
  ArrowRight,
  MessageCircle,
  Phone,
  PhoneCall,
  Sparkles,
  UserPlus,
  Users,
  Video,
} from "lucide-react";
import { Link } from "react-router";

const fadeUp = {
  initial: { opacity: 0, y: 24 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: "-80px" },
  transition: { duration: 0.55, ease: "easeOut" as const },
};

export default function Landing() {
  return (
    <div className="relative min-h-screen overflow-x-hidden">
      <AppBackdrop />

      {/* ============ Nav ============ */}
      <header className="sticky top-4 z-40 px-4">
        <nav className="glass-panel mx-auto flex max-w-5xl items-center justify-between rounded-full py-2 pl-4 pr-2">
          <Link to="/" aria-label="NChat home">
            <NChatWordmark markClassName="size-8" />
          </Link>
          <div className="hidden items-center gap-1 text-sm font-medium text-muted-foreground md:flex">
            <a href="#features" className="rounded-full px-3 py-1.5 transition hover:bg-white/60 hover:text-foreground">
              Features
            </a>
            <a href="#how" className="rounded-full px-3 py-1.5 transition hover:bg-white/60 hover:text-foreground">
              How it works
            </a>
            <a href="#calls" className="rounded-full px-3 py-1.5 transition hover:bg-white/60 hover:text-foreground">
              Calls
            </a>
          </div>
          <div className="flex items-center gap-2">
            <Button asChild variant="ghost" className="rounded-full">
              <Link to="/auth">Sign in</Link>
            </Button>
            <Button asChild className="rounded-full bg-gradient-nchat text-white shadow-md">
              <Link to="/auth">Get started</Link>
            </Button>
          </div>
        </nav>
      </header>

      {/* ============ Hero ============ */}
      <section className="mx-auto grid max-w-6xl items-center gap-14 px-6 pb-24 pt-16 md:grid-cols-2 md:pt-24">
        <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}>
          <span className="glass-soft inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-xs font-semibold text-primary">
            <Sparkles className="size-3.5" />
            Made for friends &amp; family
          </span>
          <h1 className="mt-6 text-4xl font-bold leading-[1.08] tracking-tight md:text-6xl">
            Text, talk, and laugh together —{" "}
            <span className="text-gradient">anywhere.</span>
          </h1>
          <p className="mt-5 max-w-md text-base leading-7 text-muted-foreground md:text-lg">
            NChat App is the bright, cozy home for your conversations — one-to-one
            messages, groups for everyone, and crystal-clear voice and video
            calls with the people who matter most.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Button asChild size="lg" className="rounded-full bg-gradient-nchat px-7 text-white shadow-lg">
              <Link to="/auth">
                Start chatting — it's free
                <ArrowRight className="size-4" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="glass-soft rounded-full border-transparent px-7">
              <a href="#features">See what's inside</a>
            </Button>
          </div>
          <div className="mt-10 flex flex-wrap gap-x-8 gap-y-3">
            <Stat value="1:1" label="private chats" />
            <Stat value="∞" label="group sizes" />
            <Stat value="HD" label="voice & video" />
          </div>
        </motion.div>

        {/* Hero mockup */}
        <motion.div
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.6, delay: 0.1 }}
          className="relative mx-auto w-full max-w-md"
        >
          <HeroChatMockup />
          <div className="animate-float absolute -left-4 top-10 hidden sm:block">
            <CallBadge />
          </div>
          <div className="animate-float-slow absolute -right-3 bottom-16 hidden sm:block">
            <GroupBadge />
          </div>
        </motion.div>
      </section>

      {/* ============ Features ============ */}
      <section id="features" className="mx-auto max-w-6xl px-6 py-16">
        <motion.div {...fadeUp} className="mx-auto max-w-2xl text-center">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-primary">
            Everything you need
          </p>
          <h2 className="mt-3 text-3xl font-bold tracking-tight md:text-4xl">
            One app for every kind of conversation
          </h2>
          <p className="mt-4 text-sm leading-6 text-muted-foreground md:text-base">
            From a quick hello to the big family call — NChat keeps it simple,
            bright, and unmistakably you.
          </p>
        </motion.div>

        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          <FeatureCard
            icon={<MessageCircle className="size-5" />}
            tint="from-sky-400 to-blue-500"
            title="One-to-one chat"
            body="Message anyone in your circle. Messages land in real time with read receipts, so you always know the conversation made it."
          />
          <FeatureCard
            icon={<Users className="size-5" />}
            tint="from-violet-400 to-indigo-500"
            title="Groups for everyone"
            body="Round up the family, plan with the friend group, or start a book club. Add people, rename it, and keep everyone in the loop."
          />
          <FeatureCard
            icon={<Phone className="size-5" />}
            tint="from-cyan-400 to-teal-500"
            title="Voice calls, instantly"
            body="Tap the phone icon and talk. No numbers to dial, no setup — just a clear, warm voice call with whoever you're chatting with."
          />
          <FeatureCard
            icon={<Video className="size-5" />}
            tint="from-blue-400 to-indigo-600"
            title="Video calls with a smile"
            body="See the faces and hear the laughs. Call one friend or the whole group on video, right from the conversation."
          />
          <FeatureCard
            icon={<UserPlus className="size-5" />}
            tint="from-emerald-400 to-cyan-500"
            title="Friends first"
            body="Start with a friend request and become connected the moment they accept. Your circle stays close and private."
          />
          <FeatureCard
            icon={<Sparkles className="size-5" />}
            tint="from-rose-400 to-pink-500"
            title="Bright by design"
            body="A light, glassy interface with bold color and gentle motion — fast, playful, and easy on the eyes."
          />
        </div>
      </section>

      {/* ============ How it works ============ */}
      <section id="how" className="mx-auto max-w-6xl px-6 py-16">
        <motion.div {...fadeUp} className="mx-auto max-w-2xl text-center">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-primary">
            Three steps
          </p>
          <h2 className="mt-3 text-3xl font-bold tracking-tight md:text-4xl">
            From sign-in to laughter in minutes
          </h2>
        </motion.div>

        <div className="mt-12 grid gap-5 md:grid-cols-3">
          <Step
            number="01"
            icon={<MessageCircle className="size-5" />}
            title="Sign in with your email"
            body="A quick, secure login — or just continue as a guest and get going right away."
          />
          <Step
            number="02"
            icon={<UserPlus className="size-5" />}
            title="Add your people"
            body="Find friends by name or email, send a request, and connect the moment they accept."
          />
          <Step
            number="03"
            icon={<PhoneCall className="size-5" />}
            title="Message, group & call"
            body="Chat one-to-one, gather a group, or jump on a voice or video call. All in one place."
          />
        </div>
      </section>

      {/* ============ Calls banner ============ */}
      <section id="calls" className="mx-auto max-w-6xl px-6 py-16">
        <motion.div {...fadeUp} className="glass-panel relative overflow-hidden rounded-[2rem] p-10 md:p-14">
          <div className="pointer-events-none absolute -right-16 -top-16 size-64 rounded-full bg-gradient-to-br from-sky-300/40 to-indigo-300/30 blur-2xl" />
          <div className="pointer-events-none absolute -bottom-20 left-1/3 size-64 rounded-full bg-gradient-to-br from-cyan-200/40 to-violet-200/30 blur-2xl" />
          <div className="relative grid items-center gap-8 md:grid-cols-[1fr_auto]">
            <div>
              <h2 className="text-3xl font-bold tracking-tight md:text-4xl">
                Your people are <span className="text-gradient">one tap away</span>
              </h2>
              <p className="mt-4 max-w-xl text-sm leading-7 text-muted-foreground md:text-base">
                Invite your friends and family, and NChat becomes the little
                corner of the internet where you all hang out.
              </p>
            </div>
            <Button asChild size="lg" className="rounded-full bg-gradient-nchat px-8 text-white shadow-lg">
              <Link to="/auth">
                Get started free
                <ArrowRight className="size-4" />
              </Link>
            </Button>
          </div>
        </motion.div>
      </section>

      {/* ============ Footer ============ */}
      <footer className="mx-auto max-w-6xl px-6 pb-10 pt-6">
        <div className="flex flex-col items-center justify-between gap-6 border-t border-white/50 pt-8 md:flex-row">
          <NChatWordmark markClassName="size-8" />
          <p className="text-xs text-muted-foreground">
            Made with care for friends and family.
          </p>
          <div className="flex gap-6 text-xs font-medium text-muted-foreground">
            <Link to="/auth" className="transition hover:text-foreground">
              Sign in
            </Link>
            <a href="#features" className="transition hover:text-foreground">
              Features
            </a>
            <a href="#how" className="transition hover:text-foreground">
              How it works
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <p className="text-2xl font-bold tracking-tight text-foreground">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

function FeatureCard({
  icon,
  tint,
  title,
  body,
}: {
  icon: React.ReactNode;
  tint: string;
  title: string;
  body: string;
}) {
  return (
    <motion.div
      {...fadeUp}
      className="glass-soft group rounded-3xl p-6 transition-transform duration-300 hover:-translate-y-1"
    >
      <div
        className={`mb-4 flex size-11 items-center justify-center rounded-2xl bg-gradient-to-br ${tint} text-white shadow-md transition-transform duration-300 group-hover:scale-110`}
      >
        {icon}
      </div>
      <h3 className="text-base font-bold tracking-tight">{title}</h3>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">{body}</p>
    </motion.div>
  );
}

function Step({
  number,
  icon,
  title,
  body,
}: {
  number: string;
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <motion.div {...fadeUp} className="glass-panel relative rounded-3xl p-6">
      <span className="absolute right-6 top-5 text-3xl font-black text-primary/10">
        {number}
      </span>
      <div className="mb-4 flex size-11 items-center justify-center rounded-2xl bg-gradient-nchat text-white shadow-md">
        {icon}
      </div>
      <h3 className="text-base font-bold tracking-tight">{title}</h3>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">{body}</p>
    </motion.div>
  );
}

/* ================= Hero mockup ================= */

function MockAvatar({ gradient, label }: { gradient: string; label: string }) {
  return (
    <div
      aria-hidden
      className={`flex size-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br ${gradient} text-sm font-bold text-white ring-2 ring-white/70`}
    >
      {label}
    </div>
  );
}

function HeroChatMockup() {
  return (
    <div className="glass-strong flex flex-col overflow-hidden rounded-[1.75rem] p-4 shadow-2xl">
      {/* header */}
      <div className="flex items-center gap-3 px-2 pb-3">
        <MockAvatar gradient="from-rose-400 to-pink-500" label="M" />
        <div>
          <p className="text-sm font-bold">Mom</p>
          <p className="text-[11px] text-muted-foreground">family · always replies</p>
        </div>
        <div className="ml-auto flex gap-2">
          <span className="glass-soft flex size-8 items-center justify-center rounded-full text-primary">
            <Phone className="size-3.5" />
          </span>
          <span className="glass-soft flex size-8 items-center justify-center rounded-full text-primary">
            <Video className="size-3.5" />
          </span>
        </div>
      </div>
      {/* messages */}
      <div className="space-y-2 rounded-2xl bg-white/30 p-3">
        <div className="flex justify-start">
          <div className="max-w-[80%] rounded-2xl rounded-bl-md bg-white/85 px-3.5 py-2 text-sm shadow-sm">
            Did you see the photos from the weekend? 📸
            <p className="mt-1 text-right text-[10px] text-muted-foreground">9:41</p>
          </div>
        </div>
        <div className="flex justify-end">
          <div className="max-w-[80%] rounded-2xl rounded-br-md bg-gradient-nchat px-3.5 py-2 text-sm text-white shadow-sm">
            Yes — laughing all over again 😄
            <p className="mt-1 flex items-center justify-end gap-1 text-right text-[10px] text-white/75">
              ✓✓ 9:42
            </p>
          </div>
        </div>
        <div className="flex justify-start">
          <div className="max-w-[80%] rounded-2xl rounded-bl-md bg-white/85 px-3.5 py-2 text-sm shadow-sm">
            Same time next week, then? 🍕
            <p className="mt-1 text-right text-[10px] text-muted-foreground">9:43</p>
          </div>
        </div>
      </div>
      {/* composer */}
      <div className="mt-3 flex items-center gap-2 px-1">
        <div className="flex-1 rounded-full border border-white/60 bg-white/50 px-4 py-2 text-xs text-muted-foreground">
          Message Mom…
        </div>
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-gradient-nchat text-white shadow">
          <MessageCircle className="size-4" />
        </span>
      </div>
    </div>
  );
}

function CallBadge() {
  return (
    <div className="glass-strong flex items-center gap-3 rounded-2xl px-4 py-3 shadow-xl">
      <span className="relative flex size-10 items-center justify-center rounded-full bg-emerald-500 text-white">
        <PhoneCall className="size-4" />
        <span className="absolute -right-0.5 -top-0.5 size-2.5 rounded-full bg-emerald-400 ring-2 ring-white" />
      </span>
      <div>
        <p className="text-xs font-bold">Video call</p>
        <p className="text-[10px] text-muted-foreground">with Mom · 12:04</p>
      </div>
    </div>
  );
}

function GroupBadge() {
  return (
    <div className="glass-strong flex items-center gap-3 rounded-2xl px-4 py-3 shadow-xl">
      <div className="flex -space-x-2">
        <MockAvatar gradient="from-sky-400 to-blue-500" label="J" />
        <MockAvatar gradient="from-violet-400 to-indigo-500" label="S" />
        <MockAvatar gradient="from-cyan-400 to-teal-500" label="A" />
      </div>
      <div>
        <p className="text-xs font-bold">Family · 5 members</p>
        <p className="text-[10px] text-muted-foreground">3 new messages</p>
      </div>
    </div>
  );
}
