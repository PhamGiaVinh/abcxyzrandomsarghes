import { useTranslation } from "react-i18next";

/** Legacy image pointers have no schedule-specific provenance in this read contract. */
export function LegacyScheduleEvidenceNote() {
  const { t } = useTranslation();
  return <p role="note" className="mt-2 text-xs text-muted-foreground">{t("legacyScheduleEvidence")}</p>;
}
