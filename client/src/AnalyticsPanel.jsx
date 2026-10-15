import { useState } from "react";

function todayKey() {
  return new Date().toLocaleDateString("en-CA");
}

function prettyDate(dateText) {
  const date = new Date(`${dateText}T00:00:00`);
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

export default function AnalyticsPanel({
  history = [],
  wordCount = 0,
  saveStatus = "",
  memberCount = 1,
  canvasTitle = "",
}) {
  const [expanded, setExpanded] = useState(true);

  const today = history.find((entry) => entry.date === todayKey());
  const todayEdits = today ? today.edits || 0 : 0;
  const todayAI = today ? today.aiPrompts || 0 : 0;

  const biggestDay = Math.max(1, ...history.map((entry) => entry.edits || 0));

  return (
    <aside className="analytics-panel">
      <div className="analytics-header">
        <div>
          <p className="analytics-eyebrow">THIS CANVAS</p>
          <h2>Analytics</h2>
        </div>
        <button
          className="icon-button"
          onClick={() => setExpanded((value) => !value)}
          aria-label={expanded ? "Collapse analytics" : "Expand analytics"}
        >
          {expanded ? "−" : "+"}
        </button>
      </div>

      {expanded && (
        <div className="analytics-content">
          <section className="analytics-score-card">
            <p>Edits today</p>
            <div className="analytics-score">{todayEdits}</div>
            <small>{canvasTitle}</small>
          </section>

          <section className="analytics-metric">
            <span>AI prompts today</span>
            <strong>{todayAI}</strong>
          </section>

          <section className="analytics-metric">
            <span>Words in canvas</span>
            <strong>{wordCount}</strong>
          </section>

          <section className="analytics-metric">
            <span>People with access</span>
            <strong>{memberCount}</strong>
          </section>

          <section className="analytics-metric">
            <span>Cloud save</span>
            <strong>{saveStatus}</strong>
          </section>

          <p className="history-heading">Last 7 active days</p>

          {history.length === 0 && (
            <p className="analytics-note">History starts after your first saved change.</p>
          )}

          {history.map((entry) => (
            <div className="history-row" key={entry.date}>
              <div className="history-top">
                <span>{prettyDate(entry.date)}</span>
                <span>
                  {entry.edits || 0} edits · {entry.aiPrompts || 0} AI
                </span>
              </div>
              <div className="history-bar">
                <div
                  className="history-fill"
                  style={{ width: `${((entry.edits || 0) / biggestDay) * 100}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </aside>
  );
}
