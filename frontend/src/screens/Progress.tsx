import { useEffect, useState } from "react";
import { api } from "../api/client";
import type { ProgressData } from "../api/types";
import { Button } from "../ui/Button";
import { StatusChip } from "../ui/StatusChip";

import { useAuth } from "../auth/firebase";

export function Progress({ onBack }: { onBack: () => void }) {
  const { isAnonymous, displayName, user, signInWithGoogle } = useAuth();
  const [data, setData] = useState<ProgressData | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const p = await api.getProgress();
        setData(p);
      } catch (err) {
        console.error("Progress error:", err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [user]);

  const handleLinkGoogle = async () => {
    try {
      setSyncing(true);
      await signInWithGoogle();
      const p = await api.getProgress();
      setData(p);
    } catch (e) {
      console.warn("Failed to sync with Google:", e);
    } finally {
      setSyncing(false);
    }
  };

  if (loading) {
    return (
      <main className="progress-view progress-view--loading">
        <p>Loading your progress...</p>
      </main>
    );
  }

  const demonstratedCount = data?.concepts.filter((c) => c.status === "demonstrated").length || 0;
  const developingCount = data?.concepts.filter((c) => c.status === "developing").length || 0;

  return (
    <main className="progress-view">
      <header className="progress-view__head">
        <Button variant="quiet" onClick={onBack}>
          &larr; Back
        </Button>
        <h1 className="progress-view__title">My Learning Progress</h1>
        <p className="progress-view__sub">
          Transparent, evidence-based mastery tracking across your study sessions.
        </p>
      </header>

      {/* Account Sync Card */}
      <section className="account-sync-card">
        {isAnonymous ? (
          <div className="account-sync-card__guest">
            <div>
              <h3 className="account-sync-card__title">Sync Your Mastery</h3>
              <p className="account-sync-card__desc">
                You're studying in a guest session. Link your Google account so your progress and error tracking follow you on any device.
              </p>
            </div>
            <Button
              className="account-sync-card__btn"
              onClick={handleLinkGoogle}
              disabled={syncing}
            >
              {syncing ? "Connecting..." : "Save Progress with Google"}
            </Button>
          </div>
        ) : (
          <div className="account-sync-card__synced">
            <span className="account-sync-card__badge">✓ Cloud Synced</span>
            <p className="account-sync-card__desc">
              Logged in as <strong>{displayName}</strong> ({user?.email || "Google Account"}). All scored attempts and concept masteries are saved.
            </p>
          </div>
        )}
      </section>

      {/* Overview Stat Cards */}
      <section className="stats-row">
        <div className="stat-card">
          <span className="stat-card__number">{demonstratedCount}</span>
          <span className="stat-card__label">Demonstrated Mastery</span>
          <span className="stat-card__note">Proven on multiple contexts without hints</span>
        </div>
        <div className="stat-card">
          <span className="stat-card__number">{developingCount}</span>
          <span className="stat-card__label">Developing Understanding</span>
          <span className="stat-card__note">Needs additional practice or transfer check</span>
        </div>
        <div className="stat-card">
          <span className="stat-card__number">{data?.recentSessions.length || 0}</span>
          <span className="stat-card__label">Diagnostic Sessions</span>
          <span className="stat-card__note">Completed learning loops</span>
        </div>
      </section>

      {/* Concept Mastery List */}
      <section className="progress-section">
        <h2 className="progress-section__title">Concepts Assessed</h2>
        {data?.concepts && data.concepts.length > 0 ? (
          <div className="concept-list">
            {data.concepts.map((c) => (
              <div key={c.conceptId} className="concept-list-item">
                <div className="concept-list-item__left">
                  <span className="concept-list-item__name">{c.conceptName}</span>
                  <span className="concept-list-item__meta">{c.evidenceCount} scored attempts</span>
                </div>
                <StatusChip status={c.status} />
              </div>
            ))}
          </div>
        ) : (
          <p className="empty-state">No concepts assessed yet. Start a study session on your notes!</p>
        )}
      </section>

      {/* Recurring Misconceptions */}
      {data?.recurringErrors && data.recurringErrors.length > 0 && (
        <section className="progress-section">
          <h2 className="progress-section__title">Recurring Error Patterns</h2>
          <div className="recurring-list">
            {data.recurringErrors.map((err) => (
              <div key={err.id} className="recurring-item">
                <span className="chip chip--warning">{err.count}x detected</span>
                <span className="recurring-item__label">{err.label}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Recent Sessions */}
      {data?.recentSessions && data.recentSessions.length > 0 && (
        <section className="progress-section">
          <h2 className="progress-section__title">Recent Study Sessions</h2>
          <div className="session-history-list">
            {data.recentSessions.map((s) => (
              <div key={s.id} className="history-item">
                <div className="history-item__left">
                  <span className="history-item__title">{s.conceptName}</span>
                  <span className="history-item__date">
                    {s.startedAt ? new Date(s.startedAt).toLocaleDateString() : ""}
                  </span>
                </div>
                <div className="history-item__right">
                  <StatusChip status={s.statusBefore} />
                  <span className="history-item__arrow">&rarr;</span>
                  <StatusChip status={s.statusAfter} />
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
