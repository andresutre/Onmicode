import { OverlayNav } from "../../../app/shell/TitleBar";
import { WindowControls } from "../../../app/shell/WindowControls";
import { IS_MAC } from "../../../platform/tauri/platform";
import { useLockOverscroll } from "../../../shared/hooks/useLockOverscroll";
import { Gauge } from "../../../shared/ui/icons";
import type { ProviderAccountProvider } from "../../providers/model/providerAccounts";
import { UsageLimitsSection } from "./UsageLimitsSection";

type Props = {
  tabbed?: boolean;
  /** False while another title tab covers this one. */
  active?: boolean;
  besideRail?: boolean;
  compactRail?: boolean;
  onClose: () => void;
  onToggleSidebar?: () => void;
  onManageAccounts?: (provider: ProviderAccountProvider) => void;
};

/** Plan limits for every provider and account, on a page of their own. */
export function UsageView({
  tabbed = false,
  active = true,
  besideRail = false,
  compactRail = false,
  onClose,
  onToggleSidebar,
  onManageAccounts,
}: Props) {
  const lockOverscroll = useLockOverscroll<HTMLDivElement>();
  return (
    <div
      role="region"
      aria-label="Usage"
      data-app-usage
      className="flex min-h-0 min-w-0 flex-1 flex-col text-content"
    >
      {!tabbed ? (
        <div
          data-app-view-header
          className="flex h-10 shrink-0 select-none items-center border-b border-stroke"
          data-tauri-drag-region="deep"
        >
          {IS_MAC && compactRail ? <div className="w-4 shrink-0" /> : null}
          {IS_MAC && !besideRail ? <div className="w-[78px] shrink-0" /> : null}
          {besideRail ? null : (
            <OverlayNav onBack={onClose} onToggleSidebar={onToggleSidebar} />
          )}
          <div className="flex min-w-0 flex-1 items-center gap-2 px-3 text-[13px]">
            <Gauge
              className="size-3.5 shrink-0 text-content/45"
              strokeWidth={1.75}
            />
            <span className="min-w-0 truncate text-content">Usage</span>
          </div>
          {IS_MAC ? null : <WindowControls />}
        </div>
      ) : null}
      <div
        ref={lockOverscroll}
        className="@container/usage min-h-0 flex-1 overflow-y-auto overscroll-none"
      >
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-10 px-5 py-6 pb-16 @min-[560px]/usage:px-8 @min-[560px]/usage:py-8">
          <header>
            <h1 className="text-[20px] font-semibold leading-tight text-content">
              Usage
            </h1>
            <p className="mt-1.5 max-w-xl text-[13px] leading-relaxed text-content/45">
              Plan limits for every provider and account Onmicode can read.
            </p>
          </header>
          <UsageLimitsSection
            active={active}
            onManageAccounts={onManageAccounts}
          />
          {/* Token and cost history (features/usage/history) goes here, below the limits. */}
        </div>
      </div>
    </div>
  );
}
