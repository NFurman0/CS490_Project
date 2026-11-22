import type { AnalysisTargetSummary } from '../api';

const PLATFORM_LABELS: Record<AnalysisTargetSummary['platform'], string> = {
  google_maps: 'Google Maps',
};

interface ActiveTargetHeaderProps {
  target: AnalysisTargetSummary;
  /** Which per-target page is showing, e.g. "Target workspace", "Ingestion summary", "Q&A". */
  surface: string;
}

/**
 * The single place that tells the user which AnalysisTarget is active (S2-017).
 * Every per-target page (workspace, ingestion summary, Q&A) renders this so the
 * user never has to infer which review dataset is being analyzed.
 *
 * Only pass a target the page loaded for the current route; never a previous
 * target kept around while the next one loads.
 */
export function ActiveTargetHeader({ target, surface }: ActiveTargetHeaderProps) {
  return (
    <header className="page-heading">
      <p className="eyebrow">{surface.toUpperCase()}</p>
      <h1>{target.name}</h1>
      <p>Active target · {PLATFORM_LABELS[target.platform]} reviews</p>
    </header>
  );
}
