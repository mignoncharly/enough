import { WorkspaceFrame } from "./workspace-frame";

export function LaterSection({
  active,
  eyebrow,
  title,
  description,
  phase,
  detail,
  href,
  linkLabel,
}: {
  active: string;
  eyebrow: string;
  title: string;
  description: string;
  phase: number;
  detail: string;
  href?: string;
  linkLabel?: string;
}) {
  return (
    <WorkspaceFrame active={active} eyebrow={eyebrow} title={title} description={description}>
      <section className="account-card">
        <p className="eyebrow">Empty state · Phase {phase}</p>
        <h2>This workspace is ready for its next capability</h2>
        <p className="muted-copy">{detail}</p>
        {href && linkLabel ? (
          <a className="secondary-button link-button" href={href}>
            {linkLabel}
          </a>
        ) : null}
      </section>
    </WorkspaceFrame>
  );
}
