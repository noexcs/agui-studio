import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  Braces,
  Brain,
  Check,
  ChevronRight,
  Circle,
  Clock,
  Command,
  Copy,
  ExternalLink,
  Globe,
  Layers,
  Lock,
  MoreHorizontal,
  Paperclip,
  Play,
  Plus,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  Square,
  Terminal,
  Wrench,
  X,
  type LucideIcon,
} from "lucide-react";

const map: Record<string, LucideIcon> = {
  send: Send,
  plus: Plus,
  search: Search,
  sparkle: Sparkles,
  wrench: Wrench,
  check: Check,
  x: X,
  chevron: ChevronRight,
  "chevron-down": ChevronRight,
  copy: Copy,
  refresh: RefreshCw,
  play: Play,
  stop: Square,
  clock: Clock,
  brain: Brain,
  shield: ShieldCheck,
  layers: Layers,
  braces: Braces,
  activity: Activity,
  more: MoreHorizontal,
  paperclip: Paperclip,
  "arrow-up-right": ArrowUpRight,
  "arrow-right": ArrowRight,
  command: Command,
  terminal: Terminal,
  globe: Globe,
  lock: Lock,
  "external-link": ExternalLink,
  dot: Circle,
};

export function Icon({
  name,
  size = 16,
  strokeWidth = 1.6,
  className,
}: {
  name: string;
  size?: number;
  strokeWidth?: number;
  className?: string;
}) {
  const Component = map[name] ?? Circle;
  return <Component size={size} strokeWidth={strokeWidth} className={className} aria-hidden="true" />;
}
