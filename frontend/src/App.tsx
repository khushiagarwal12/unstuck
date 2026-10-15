import { useState } from "react";
import { BackendStatus } from "./components/BackendStatus";
import { Mark } from "./components/Mark";
import { UserAccountBar } from "./components/UserAccountBar";
import { useBackendStatus } from "./hooks/useBackendStatus";
import { Course } from "./screens/Course";
import { Home } from "./screens/Home";
import { LearningSession } from "./screens/LearningSession";
import { Progress } from "./screens/Progress";
import { StudySpace } from "./screens/StudySpace";
import { Summary } from "./screens/Summary";
import { api } from "./api/client";

type Screen = "home" | "study" | "session" | "summary" | "progress" | "course";

export default function App() {
  const { status, retry } = useBackendStatus();
  const [screen, setScreen] = useState<Screen>("home");
  const [documentId, setDocumentId] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [courseId, setCourseId] = useState<string | null>(null);

  function handleDocument(docId: string) {
    setDocumentId(docId);
    setScreen("study");
  }

  function handleCourse(cId: string) {
    setCourseId(cId);
    setScreen("course");
  }

  async function handleStartSession(conceptId: string) {
    if (!documentId) return;
    try {
      const res = await api.createSession(documentId, conceptId);
      setSessionId(res.sessionId);
      setScreen("session");
    } catch (err) {
      console.error("Failed to start session:", err);
    }
  }

  async function handleStartModuleSession(conceptId: string) {
    if (!courseId) return;
    try {
      const res = await api.startModule(courseId, conceptId);
      setSessionId(res.sessionId);
      setScreen("session");
    } catch (err) {
      console.error("Failed to start module session:", err);
    }
  }

  function handleFinishSession(sId: string) {
    setSessionId(sId);
    setScreen("summary");
  }

  return (
    <div className="shell">
      <header className="top">
        <div className="top__left">
          <button
            type="button"
            className="brand brand-btn"
            onClick={() => setScreen("home")}
            aria-label="UNSTUCK home"
          >
            <Mark />
            <span className="brand__name">unstuck</span>
          </button>
          <nav className="top__nav" aria-label="Main Navigation">
            <button
              type="button"
              className={`nav-link ${screen === "home" ? "nav-link--active" : ""}`}
              onClick={() => setScreen("home")}
            >
              Study
            </button>
            <button
              type="button"
              className={`nav-link ${screen === "progress" ? "nav-link--active" : ""}`}
              onClick={() => setScreen("progress")}
            >
              My Progress
            </button>
          </nav>
        </div>
        <div className="top__right">
          <UserAccountBar />
          <BackendStatus status={status} onRetry={retry} />
        </div>
      </header>

      {screen === "home" && (
        <Home
          onDocument={handleDocument}
          onCourse={handleCourse}
          onViewProgress={() => setScreen("progress")}
        />
      )}

      {screen === "study" && documentId && (
        <StudySpace
          documentId={documentId}
          onBack={() => setScreen("home")}
          onStartSession={handleStartSession}
        />
      )}

      {screen === "course" && courseId && (
        <Course
          courseId={courseId}
          onBack={() => setScreen("home")}
          onStartModule={handleStartModuleSession}
        />
      )}

      {screen === "session" && sessionId && (
        <LearningSession
          sessionId={sessionId}
          onExit={() => {
            if (courseId) setScreen("course");
            else if (documentId) setScreen("study");
            else setScreen("home");
          }}
          onFinish={handleFinishSession}
        />
      )}

      {screen === "summary" && sessionId && (
        <Summary
          sessionId={sessionId}
          onReturnToStudy={() => {
            if (courseId) setScreen("course");
            else if (documentId) setScreen("study");
            else setScreen("home");
          }}
          onViewProgress={() => setScreen("progress")}
        />
      )}

      {screen === "progress" && (
        <Progress onBack={() => setScreen("home")} />
      )}
    </div>
  );
}
