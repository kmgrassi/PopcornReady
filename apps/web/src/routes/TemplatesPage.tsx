import { Link } from "react-router-dom";
import { STUDIO_TEMPLATE_GROUPS, STUDIO_TEMPLATES } from "../lib/studioTemplates";

export function TemplatesPage() {
  return (
    <main className="studio-secondary">
      <section className="studio-secondary-hero">
        <div>
          <span className="studio-secondary-eyebrow">Templates</span>
          <h1>Start from a proven cut structure</h1>
          <p>
            Pick a format and Popcorn Ready will prefill the creative brief,
            duration, aspect ratio, and beat shape for the new project flow.
          </p>
        </div>
        <Link className="studio-secondary-primary" to="/projects/new">
          Blank project
        </Link>
      </section>

      <nav className="studio-secondary-pills" aria-label="Template categories">
        {STUDIO_TEMPLATE_GROUPS.map((group) => (
          <span key={group}>{group}</span>
        ))}
      </nav>

      <section className="studio-template-grid" aria-label="Template gallery">
        {STUDIO_TEMPLATES.map((template) => (
          <article className="studio-template-card" key={template.id}>
            <div className="studio-template-preview" aria-hidden="true">
              <span>{template.aspect}</span>
            </div>
            <div className="studio-template-meta">
              <span>{template.group}</span>
              <span>{template.lengthLabel}</span>
            </div>
            <h2>{template.title}</h2>
            <p>{template.brief}</p>
            <Link
              className="studio-secondary-action"
              to={`/projects/new?template=${template.id}`}
            >
              Use template
            </Link>
          </article>
        ))}
      </section>
    </main>
  );
}
