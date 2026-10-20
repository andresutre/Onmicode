import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { needsProviderLogin } from "../../../app/shell/UsageProviderChip";
import {
  loginHarness,
  supportsHarnessLogin,
} from "../../../integrations/harness/core/auth";
import {
  getHarnessAvailabilitySnapshot,
  harnessInstallGuide,
  hasProbedHarnessAvailability,
  isHarnessAvailable,
  probeHarnessAvailability,
  subscribeHarnessAvailability,
} from "../../../integrations/harness/core/availability";
import { pickFolders } from "../../../platform/tauri/fs";
import { prettyCwd, projectName } from "../../../shared/lib/paths";
import {
  ArrowLeft,
  Check,
  CircleDashed,
  Copy,
  Folder,
  FolderOpen,
  Keyboard,
  Loader,
  type IconComponent,
} from "../../../shared/ui/icons";
import { Modal } from "../../../shared/ui/Modal";
import { SecondaryButton } from "../../../shared/ui/SecondaryButton";
import { looksLikeProject } from "../../projects/model/recents";
import type { ProviderRateLimits } from "../../providers/model/rateLimits";
import {
  getCachedRateLimits,
  loadRateLimits,
  useCachedRateLimits,
} from "../../providers/model/rateLimitsCache";
import {
  HARNESS_TITLE,
  HARNESSES,
  type HarnessId,
} from "../../sessions/model/session";
import { HarnessIcon } from "../../sessions/ui/HarnessIcon";
import type { ProviderSignInState } from "../../sessions/ui/ProviderSignInPanel";
import {
  applyThemePreference,
  INSET_LAYOUT_DEFAULT,
  loadInsetLayout,
  loadThemePreference,
  saveInsetLayout,
  saveThemePreference,
  subscribeInsetLayout,
  type ThemePreference,
} from "../../settings/model/appearance";
import { saveNewLayoutPromptDismissed } from "../../settings/model/displayPrefs";
import {
  KEYBINDINGS,
  keybindingShortcutLabel,
} from "../../settings/model/settings";
import {
  agentStatus,
  isSignInChecked,
  listNames,
  splitWelcomeAgents,
  type AgentSignIn,
  type AgentStatus,
  type SignInCheckedAgent,
} from "../model/welcome";

const STEPS = [
  { id: "welcome", label: "Welcome" },
  { id: "agents", label: "Agents" },
  { id: "project", label: "Project" },
  { id: "look", label: "Look" },
  { id: "done", label: "Done" },
] as const;

const PRIMARY_BUTTON =
  "inline-flex h-8 items-center gap-1.5 rounded-lg bg-content px-3.5 text-[12px] font-medium text-background-base transition-transform duration-150 ease-out hover:bg-content/85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent active:scale-[0.98] disabled:cursor-default disabled:opacity-55";
const GHOST_BUTTON =
  "inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[12px] text-content/60 hover:bg-content/10 hover:text-content focus-visible:outline-2 focus-visible:outline-accent";

/**
 * First-run setup: agents, a first project and a look. Every step can be
 * skipped, and closing it from anywhere keeps what was already chosen.
 */
export function WelcomeDialog({
  onFinish,
}: {
  /** Folders picked on the Project step; empty when none was. */
  onFinish: (projects: string[]) => void;
}) {
  const [step, setStep] = useState(0);
  const [projects, setProjects] = useState<string[]>([]);
  const next = () => setStep((index) => Math.min(index + 1, STEPS.length - 1));
  const back = () => setStep((index) => Math.max(index - 1, 0));
  const finish = () => onFinish(projects);
  const id = STEPS[step].id;

  return (
    <Modal
      title="Set up Onmicode"
      size="md"
      minimalHeader
      fitViewport
      onClose={finish}
    >
      <div className="flex min-h-[460px] flex-col px-6 pt-4 pb-5">
        <StepTrail current={step} onSelect={setStep} />
        {id === "welcome" ? (
          <WelcomeStep onNext={next} onSkip={finish} />
        ) : id === "agents" ? (
          <AgentsStep onBack={back} onNext={next} />
        ) : id === "project" ? (
          <ProjectStep
            projects={projects}
            onProjects={setProjects}
            onBack={back}
            onNext={next}
          />
        ) : id === "look" ? (
          <LookStep onBack={back} onNext={next} />
        ) : (
          <DoneStep projects={projects} onBack={back} onFinish={finish} />
        )}
      </div>
    </Modal>
  );
}

function StepTrail({
  current,
  onSelect,
}: {
  current: number;
  onSelect: (index: number) => void;
}) {
  return (
    <ol
      aria-label="Setup steps"
      className="flex flex-wrap items-center gap-1 pr-8 text-[11px]"
    >
      {STEPS.map((step, index) => (
        <li key={step.id} className="flex items-center gap-1">
          {index > 0 ? (
            <span aria-hidden className="h-px w-3 bg-content/15" />
          ) : null}
          {index < current ? (
            <button
              type="button"
              aria-label={`Back to ${step.label}`}
              onClick={() => onSelect(index)}
              className="rounded px-1.5 py-0.5 text-content/55 hover:bg-content/8 hover:text-content focus-visible:outline-2 focus-visible:outline-accent"
            >
              {step.label}
            </button>
          ) : (
            <span
              aria-current={index === current ? "step" : undefined}
              className={`px-1.5 py-0.5 ${
                index === current
                  ? "font-medium text-content"
                  : "text-content/30"
              }`}
            >
              {step.label}
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}

function StepHeader({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <header className="mt-5">
      <h3 className="text-[20px] font-semibold leading-tight tracking-tight text-content">
        {title}
      </h3>
      {children ? (
        <p className="mt-1.5 text-[13px] leading-relaxed text-content/55">
          {children}
        </p>
      ) : null}
    </header>
  );
}

function StepFooter({
  onBack,
  onSkip,
  skipLabel = "Skip",
  children,
}: {
  onBack?: () => void;
  onSkip?: () => void;
  skipLabel?: string;
  children?: ReactNode;
}) {
  return (
    <footer className="mt-auto flex items-center gap-2 pt-6">
      {onBack ? (
        <button type="button" className={GHOST_BUTTON} onClick={onBack}>
          <ArrowLeft className="size-3.5" aria-hidden />
          Back
        </button>
      ) : null}
      <span className="flex-1" />
      {onSkip ? (
        <button type="button" className={GHOST_BUTTON} onClick={onSkip}>
          {skipLabel}
        </button>
      ) : null}
      {children}
    </footer>
  );
}

const LINEUP: HarnessId[] = ["cursor", "codex", "claude", "opencode", "grok"];

function WelcomeStep({
  onNext,
  onSkip,
}: {
  onNext: () => void;
  onSkip: () => void;
}) {
  return (
    <>
      <div aria-hidden className="mt-8 flex items-center justify-center gap-3">
        {LINEUP.map((harness, index) => {
          const distance = Math.abs(index - 2);
          const size = 60 - distance * 10;
          return (
            <span
              key={harness}
              className="grid place-items-center rounded-2xl bg-content/[0.06] shadow-sm ring-1 ring-inset ring-content/[0.08]"
              style={{ width: size, height: size, opacity: 1 - distance * 0.2 }}
            >
              <HarnessIcon
                harness={harness}
                className={
                  distance === 0
                    ? "size-8"
                    : distance === 1
                      ? "size-6"
                      : "size-5"
                }
              />
            </span>
          );
        })}
      </div>
      <StepHeader title="Welcome to Onmicode">
        One desktop app for the coding agents you already use. Run Claude Code,
        Codex, Cursor and others side by side, each conversation in its own
        session.
      </StepHeader>
      <p className="mt-3 text-[12px] leading-relaxed text-content/45">
        Setup takes a minute: check your agents, pick a first project and choose
        a look. Every step can be skipped, and you can come back here from
        Settings or the command palette.
      </p>
      <StepFooter onSkip={onSkip} skipLabel="Skip setup">
        <button
          type="button"
          autoFocus
          className={PRIMARY_BUTTON}
          onClick={onNext}
        >
          Get started
        </button>
      </StepFooter>
    </>
  );
}

function useHarnessAvailability() {
  useSyncExternalStore(
    subscribeHarnessAvailability,
    getHarnessAvailabilitySnapshot,
    getHarnessAvailabilitySnapshot,
  );
  return hasProbedHarnessAvailability();
}

function AgentsStep({
  onBack,
  onNext,
}: {
  onBack: () => void;
  onNext: () => void;
}) {
  const probed = useHarnessAvailability();
  const [showMore, setShowMore] = useState(false);
  const [checking, setChecking] = useState(false);
  // Bumped by Check again so sign-in reads skip their cache.
  const [recheck, setRecheck] = useState(0);
  const { shown, more } = splitWelcomeAgents(isHarnessAvailable);

  useEffect(() => {
    void probeHarnessAvailability();
  }, []);

  const checkAgain = () => {
    setChecking(true);
    void probeHarnessAvailability({ force: true }).finally(() => {
      setChecking(false);
      setRecheck((value) => value + 1);
    });
  };

  return (
    <>
      <StepHeader title="Your coding agents">
        Onmicode drives the agent CLIs installed on this computer. You need at
        least one, signed in to your account.
      </StepHeader>
      <ul
        aria-label="Coding agents"
        className="mt-4 max-h-[300px] overflow-y-auto rounded-xl border border-content/10 bg-content/3"
      >
        {[...shown, ...(showMore ? more : [])].map((harness) =>
          isSignInChecked(harness) ? (
            <SignInCheckedAgentRow
              key={harness}
              harness={harness}
              probed={probed}
              recheck={recheck}
            />
          ) : (
            <AgentRow
              key={harness}
              harness={harness}
              status={agentStatus({
                probed,
                installed: isHarnessAvailable(harness),
              })}
            />
          ),
        )}
      </ul>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-content/45">
        {more.length > 0 ? (
          <button
            type="button"
            aria-expanded={showMore}
            className="rounded text-content/60 underline-offset-2 hover:text-content hover:underline focus-visible:outline-2 focus-visible:outline-accent"
            onClick={() => setShowMore((value) => !value)}
          >
            {showMore ? "Show fewer agents" : `Show ${more.length} more agents`}
          </button>
        ) : null}
        <span className="flex-1" />
        <span>Installed one just now?</span>
        <SecondaryButton onClick={checkAgain} disabled={checking}>
          {checking ? (
            <Loader className="size-3.5 animate-spin" aria-hidden />
          ) : null}
          Check again
        </SecondaryButton>
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-content/40">
        If a CLI you installed still isn't found, restart Onmicode so it picks
        up your updated PATH.
      </p>
      <StepFooter onBack={onBack} onSkip={onNext}>
        <button
          type="button"
          autoFocus
          className={PRIMARY_BUTTON}
          onClick={onNext}
        >
          Continue
        </button>
      </StepFooter>
    </>
  );
}

function signInFromLimits(limits: ProviderRateLimits): AgentSignIn {
  if (limits.status === "idle" || limits.status === "fetching")
    return "checking";
  return needsProviderLogin(limits) ? "signedOut" : "signedIn";
}

/** Claude Code and Codex report their sign-in through the usage read. */
function SignInCheckedAgentRow({
  harness,
  probed,
  recheck,
}: {
  harness: SignInCheckedAgent;
  probed: boolean;
  recheck: number;
}) {
  const installed = isHarnessAvailable(harness);
  const limits = useCachedRateLimits(harness);

  useEffect(() => {
    if (installed) void loadRateLimits(harness, "default", recheck > 0);
  }, [harness, installed, recheck]);

  return (
    <AgentRow
      harness={harness}
      status={agentStatus({
        probed,
        installed,
        signIn: signInFromLimits(limits),
      })}
      verifySignIn={() => loadRateLimits(harness, "default", true)}
    />
  );
}

function AgentRow({
  harness,
  status,
  verifySignIn,
}: {
  harness: HarnessId;
  status: AgentStatus;
  /** Reads the sign-in back after the login flow exits. */
  verifySignIn?: () => Promise<ProviderRateLimits>;
}) {
  const [login, setLogin] = useState<ProviderSignInState>("idle");
  const [error, setError] = useState<string | null>(null);
  const title = HARNESS_TITLE[harness];
  const guide = harnessInstallGuide(harness);
  const signedIn = login === "complete" || status === "ready";
  const canSignIn =
    !signedIn &&
    supportsHarnessLogin(harness) &&
    (status === "signedOut" || status === "installed");

  const signIn = async () => {
    setLogin("running");
    setError(null);
    try {
      await loginHarness(harness);
      const verified = await verifySignIn?.();
      if (verified && needsProviderLogin(verified)) {
        throw new Error(
          verified.error || `${title} sign-in could not be verified.`,
        );
      }
      setLogin("complete");
    } catch (reason) {
      setLogin("error");
      setError(
        reason instanceof Error
          ? reason.message
          : `Could not sign in to ${title}.`,
      );
    }
  };

  const detail =
    status === "checking"
      ? "Checking…"
      : status === "missing"
        ? guide.command
          ? "Not installed. Run this in a terminal:"
          : (guide.steps ?? "Not installed.")
        : signedIn
          ? status === "installed"
            ? "Signed in."
            : "Installed and signed in."
          : status === "signedOut"
            ? "Installed, not signed in yet."
            : canSignIn
              ? "Installed. Sign in if you haven't yet."
              : "Installed.";

  return (
    <li className="flex items-start gap-3 border-b border-content/5 px-3.5 py-3 last:border-b-0">
      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-content/[0.06] ring-1 ring-inset ring-content/[0.08]">
        <HarnessIcon harness={harness} className="size-4.5" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium leading-5 text-content">
          {title}
        </div>
        <p className="text-[11.5px] leading-4 text-content/45">{detail}</p>
        {status === "missing" && guide.command ? (
          <code className="mt-1.5 block select-text break-all rounded-md bg-content/[0.06] px-2 py-1 font-mono text-[11px] leading-4 text-content/75">
            {guide.command}
          </code>
        ) : null}
        {login === "error" && error ? (
          <p className="mt-1 text-[11px] leading-4 text-red-500" role="status">
            {error}
          </p>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-2 pt-0.5">
        {status === "checking" ? (
          <Loader
            className="size-3.5 animate-spin text-content/40"
            aria-hidden
          />
        ) : status === "missing" ? (
          guide.command ? (
            <CopyCommand command={guide.command} title={title} />
          ) : null
        ) : canSignIn ? (
          <SecondaryButton
            onClick={() => void signIn()}
            disabled={login === "running"}
          >
            {login === "running" ? (
              <Loader className="size-3.5 animate-spin" aria-hidden />
            ) : null}
            {login === "running" ? "Waiting for browser…" : "Sign in"}
          </SecondaryButton>
        ) : (
          <span className="inline-flex items-center gap-1 text-[12px] font-medium text-emerald-500">
            <Check className="size-3.5" aria-hidden />
            {signedIn ? "Ready" : "Installed"}
          </span>
        )}
      </div>
    </li>
  );
}

function CopyCommand({ command, title }: { command: string; title: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <SecondaryButton
      aria-label={`Copy ${title} install command`}
      onClick={() =>
        void navigator.clipboard
          .writeText(command)
          .then(() => setCopied(true))
          .catch(() => undefined)
      }
    >
      {copied ? (
        <Check className="size-3.5 text-emerald-500" aria-hidden />
      ) : (
        <Copy className="size-3.5" aria-hidden />
      )}
      <span aria-live="polite">{copied ? "Copied" : "Copy"}</span>
    </SecondaryButton>
  );
}

function ProjectStep({
  projects,
  onProjects,
  onBack,
  onNext,
}: {
  projects: string[];
  onProjects: (projects: string[]) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const continueRef = useRef<HTMLButtonElement>(null);

  const choose = async () => {
    setPicking(true);
    setError(null);
    try {
      // Same picker as Open Project, so several folders can be taken at once.
      const picked = await pickFolders("Choose a project folder");
      if (picked.length === 0) return;
      const usable = picked.filter(looksLikeProject);
      if (usable.length === 0) {
        setError(
          "That folder can't be opened as a project. Choose the folder your code is in.",
        );
        return;
      }
      onProjects(usable);
      requestAnimationFrame(() => continueRef.current?.focus());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setPicking(false);
    }
  };

  return (
    <>
      <StepHeader title="Pick a first project">
        Choose a folder with code in it. When setup is done, Onmicode opens a
        new session there.
      </StepHeader>
      {projects.length === 0 ? (
        <button
          type="button"
          autoFocus
          disabled={picking}
          onClick={() => void choose()}
          className="mt-5 flex w-full flex-col items-center gap-2 rounded-xl border border-dashed border-content/15 px-4 py-8 text-content/60 hover:border-content/25 hover:bg-content/3 hover:text-content focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-default disabled:opacity-60"
        >
          <FolderOpen className="size-6" aria-hidden />
          <span className="text-[13px] font-medium">Choose a folder…</span>
        </button>
      ) : (
        <div className="mt-5 flex items-start gap-3 rounded-xl border border-content/10 bg-content/3 px-3.5 py-3">
          <ul
            aria-label="Chosen folders"
            className="min-w-0 flex-1 space-y-2.5"
          >
            {projects.map((path) => (
              <li key={path} className="flex items-center gap-3">
                <Folder
                  className="size-4 shrink-0 text-content/50"
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-medium text-content">
                    {projectName(path)}
                  </div>
                  <div className="truncate text-[11.5px] text-content/45">
                    {prettyCwd(path)}
                  </div>
                </div>
              </li>
            ))}
          </ul>
          <SecondaryButton disabled={picking} onClick={() => void choose()}>
            Change…
          </SecondaryButton>
        </div>
      )}
      {error ? (
        <p className="mt-2 text-[12px] leading-4 text-red-500" role="status">
          {error}
        </p>
      ) : null}
      <StepFooter
        onBack={onBack}
        onSkip={() => {
          onProjects([]);
          onNext();
        }}
      >
        <button
          ref={continueRef}
          type="button"
          autoFocus={projects.length > 0}
          disabled={projects.length === 0}
          className={PRIMARY_BUTTON}
          onClick={onNext}
        >
          Continue
        </button>
      </StepFooter>
    </>
  );
}

const THEME_OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: "system", label: "System" },
  { value: "dark", label: "Dark" },
  { value: "light", label: "Light" },
];

const LAYOUT_OPTIONS: { value: "classic" | "new"; label: string }[] = [
  { value: "classic", label: "Classic" },
  { value: "new", label: "New" },
];

function LookStep({
  onBack,
  onNext,
}: {
  onBack: () => void;
  onNext: () => void;
}) {
  const [initial] = useState(() => ({
    theme: loadThemePreference(),
    inset: loadInsetLayout(),
  }));
  const [theme, setTheme] = useState(initial.theme);
  const inset = useSyncExternalStore(
    subscribeInsetLayout,
    loadInsetLayout,
    () => INSET_LAYOUT_DEFAULT,
  );

  const onTheme = (next: ThemePreference) => {
    applyThemePreference(next);
    saveThemePreference(next);
    setTheme(next);
  };

  const onLayout = (next: boolean) => {
    // Choosing here answers the "Try the new layout" notice too.
    saveNewLayoutPromptDismissed(true);
    saveInsetLayout(next);
  };

  // Both apply as soon as they are picked, so Skip puts them back.
  const skip = () => {
    if (theme !== initial.theme) onTheme(initial.theme);
    if (inset !== initial.inset) saveInsetLayout(initial.inset);
    onNext();
  };

  return (
    <>
      <StepHeader title="Choose a look">
        Changes show right away. Find these and more in Settings → Appearance.
      </StepHeader>
      <div className="mt-5 overflow-hidden rounded-xl border border-content/10 bg-content/3">
        <LookRow label="Theme" description="System follows your OS appearance.">
          <ChoiceGroup
            label="Theme"
            value={theme}
            options={THEME_OPTIONS}
            onChange={onTheme}
            autoFocus
          />
        </LookRow>
        <LookRow
          label="Layout"
          description="New has a redesigned sidebar, project switcher and workspace tabs."
        >
          <ChoiceGroup
            label="Layout"
            value={inset ? "new" : "classic"}
            options={LAYOUT_OPTIONS}
            onChange={(value) => onLayout(value === "new")}
          />
        </LookRow>
      </div>
      <StepFooter onBack={onBack} onSkip={skip}>
        <button type="button" className={PRIMARY_BUTTON} onClick={onNext}>
          Continue
        </button>
      </StepFooter>
    </>
  );
}

function LookRow({
  label,
  description,
  children,
}: {
  label: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center gap-6 border-b border-content/5 px-4 py-3.5 last:border-b-0">
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium text-content">{label}</div>
        <p className="mt-0.5 text-[12px] leading-relaxed text-content/45">
          {description}
        </p>
      </div>
      {children}
    </div>
  );
}

/** A segmented radio group; arrow keys move the choice, as in a native one. */
function ChoiceGroup<T extends string>({
  label,
  value,
  options,
  onChange,
  autoFocus = false,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  autoFocus?: boolean;
}) {
  const radios = useRef<(HTMLButtonElement | null)[]>([]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step =
      event.key === "ArrowRight" || event.key === "ArrowDown"
        ? 1
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? -1
          : 0;
    if (step === 0) return;
    event.preventDefault();
    const current = options.findIndex((option) => option.value === value);
    const next = (current + step + options.length) % options.length;
    onChange(options[next].value);
    radios.current[next]?.focus();
  };

  return (
    <div
      role="radiogroup"
      aria-label={label}
      onKeyDown={onKeyDown}
      className="inline-grid shrink-0 gap-0.5 rounded-md border border-content/10 p-0.5 text-[12px]"
      style={{
        gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))`,
      }}
    >
      {options.map((option, index) => {
        const checked = option.value === value;
        return (
          <button
            key={option.value}
            ref={(element) => {
              radios.current[index] = element;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            autoFocus={autoFocus && checked}
            onClick={() => onChange(option.value)}
            className={`min-w-0 rounded-[5px] px-2.5 py-1 focus-visible:outline-2 focus-visible:outline-accent ${
              checked
                ? "bg-selection text-content"
                : "text-content/50 hover:text-content"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function shortcutFor(command: string): string | null {
  const binding = KEYBINDINGS.find((row) => row.command === command);
  return binding ? keybindingShortcutLabel(command, binding.keys) : null;
}

function DoneStep({
  projects,
  onBack,
  onFinish,
}: {
  projects: string[];
  onBack: () => void;
  onFinish: () => void;
}) {
  const probed = useHarnessAvailability();
  const installed = HARNESSES.filter(isHarnessAvailable);
  const signedOut = installed.filter(
    (harness) =>
      isSignInChecked(harness) &&
      needsProviderLogin(getCachedRateLimits(harness)),
  );
  const title = (harness: HarnessId) => HARNESS_TITLE[harness];
  const openProject = shortcutFor("App: Open Project");
  const palette = shortcutFor("App: Command Palette");

  return (
    <>
      <StepHeader title="You're all set" />
      <ul className="mt-5 space-y-4">
        <Summary
          label="Agents"
          done={installed.length > 0 && signedOut.length === 0}
        >
          {installed.length > 0
            ? `${listNames(installed.map(title))} ${installed.length === 1 ? "is" : "are"} installed.`
            : probed
              ? "No agent CLI found yet. Install one when you're ready; Settings → Providers lists them all."
              : "Still looking for agent CLIs on this computer."}
          {signedOut.length > 0
            ? ` ${listNames(signedOut.map(title))} still ${signedOut.length === 1 ? "needs" : "need"} a sign-in.`
            : ""}
        </Summary>
        <Summary label="Project" done={projects.length > 0}>
          {projects.length > 0
            ? `${listNames(projects.map(projectName))} ${projects.length === 1 ? "opens" : "open"} in a new session.`
            : `Open a project any time${openProject ? ` with ${openProject}` : " from the project rail"}.`}
        </Summary>
        <Summary label="Command palette" icon={Keyboard}>
          {palette ? `Press ${palette} to run any command. ` : ""}
          Run Show Welcome from it to see this again.
        </Summary>
      </ul>
      <StepFooter onBack={onBack}>
        <button
          type="button"
          autoFocus
          className={PRIMARY_BUTTON}
          onClick={onFinish}
        >
          {projects.length > 0 ? "Start coding" : "Done"}
        </button>
      </StepFooter>
    </>
  );
}

function Summary({
  label,
  done = false,
  icon,
  children,
}: {
  label: string;
  done?: boolean;
  /** Replaces the done/pending mark for a row that is only a tip. */
  icon?: IconComponent;
  children: ReactNode;
}) {
  const Icon = icon ?? (done ? Check : CircleDashed);
  return (
    <li className="flex gap-3">
      <Icon
        className={`mt-0.5 size-3.5 shrink-0 ${done ? "text-emerald-500" : "text-content/40"}`}
        aria-hidden
      />
      <div className="min-w-0">
        <div className="text-[13px] font-medium text-content">{label}</div>
        <p className="mt-0.5 text-[12px] leading-relaxed text-content/55">
          {children}
        </p>
      </div>
    </li>
  );
}
