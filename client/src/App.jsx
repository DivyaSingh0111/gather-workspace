import { useEffect, useMemo, useRef, useState } from "react";
import { onAuthStateChanged, signInWithPopup, signOut } from "firebase/auth";
import {
  addDoc,
  arrayRemove,
  arrayUnion,
  collection,
  doc,
  increment,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";

import { auth, db, googleProvider } from "./firebase";
import AnalyticsPanel from "./AnalyticsPanel";
import TableEditor from "./TableEditor";
import DrawBoard, { autoLayout } from "./DrawBoard";
import "./App.css";

// Change the app name here and it changes everywhere in the screen.
const APP_NAME = "TriBoard AI";
const APP_TAGLINE = "Write, plan and sketch together";

const MODELS = [
  { label: "Gemini 3.8 Flash", value: "gemini-3.8-flash" },
  { label: "GPT-OSS 120B (Groq)", value: "groq-gpt-oss" },
];

const TABS = [
  { name: "Notes", icon: "▤" },
  { name: "Document", icon: "▧" },
  { name: "Table", icon: "▦" },
  { name: "Draw", icon: "✎" },
];

const PROMPT_IDEAS = {
  Notes: "Make a blank checklist format I can fill in",
  Document: "Give me a project report format with headings",
  Table: "Create a weekly study planner format",
  Draw: "Outline the steps of applying for a job",
};

// Table and drawing are stored as text (JSON) because Firestore
// does not allow lists inside lists.
const EMPTY_CONTENT = { notes: "", documentText: "", tableJson: "", drawJson: "" };

function todayKey() {
  return new Date().toLocaleDateString("en-CA");
}

function blankRows(columnCount, howMany) {
  return Array.from({ length: howMany }, () => Array.from({ length: columnCount }, () => ""));
}

function defaultTable() {
  return { columns: ["Column 1", "Column 2", "Column 3"], rows: blankRows(3, 5) };
}

function parseTable(text) {
  try {
    const data = JSON.parse(text);
    if (Array.isArray(data.columns) && data.columns.length > 0 && Array.isArray(data.rows)) {
      const columns = data.columns.map((name) => String(name));
      const rows = data.rows.map((row) =>
        columns.map((_, i) => (Array.isArray(row) && row[i] != null ? String(row[i]) : ""))
      );
      return { columns, rows: rows.length > 0 ? rows : blankRows(columns.length, 1) };
    }
  } catch (err) {
    // fall through to the default table
  }
  return defaultTable();
}

function parseDraw(text) {
  try {
    const data = JSON.parse(text);
    if (Array.isArray(data.nodes)) {
      return {
        nodes: data.nodes,
        edges: Array.isArray(data.edges) ? data.edges : [],
        strokes: Array.isArray(data.strokes) ? data.strokes : [],
      };
    }
  } catch (err) {
    // fall through to the empty drawing
  }
  return { nodes: [], edges: [], strokes: [] };
}

function tableHasWriting(text) {
  if (!text) return false;
  const table = parseTable(text);
  return table.rows.some((row) => row.some((cell) => cell.trim() !== ""));
}

function countWords(content) {
  const tableText = content.tableJson
    ? parseTable(content.tableJson)
        .rows.map((row) => row.join(" "))
        .join(" ")
    : "";
  return [content.notes, content.documentText, tableText]
    .join(" ")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function timeValue(item) {
  return item.updatedAt && item.updatedAt.toMillis ? item.updatedAt.toMillis() : 0;
}

export default function App() {
  const [user, setUser] = useState(null);
  const [authReady, setAuthReady] = useState(false);

  const [canvases, setCanvases] = useState([]);
  const [listReady, setListReady] = useState(false);
  const [canvasId, setCanvasId] = useState(null);
  const [canvasReady, setCanvasReady] = useState(false);

  const [meta, setMeta] = useState({ title: "", ownerUid: "", ownerEmail: "", memberEmails: [] });
  const [titleDraft, setTitleDraft] = useState("");
  const [content, setContent] = useState(EMPTY_CONTENT);
  const [history, setHistory] = useState([]);

  const [activeTab, setActiveTab] = useState("Notes");
  const [prompt, setPrompt] = useState("");
  const [model, setModel] = useState(MODELS[0].value);
  const [loadingAI, setLoadingAI] = useState(false);
  const [aiPreview, setAiPreview] = useState(null);
  const [error, setError] = useState("");
  const [saveStatus, setSaveStatus] = useState("Waiting");
  const [showAnalytics, setShowAnalytics] = useState(true);
  const [toast, setToast] = useState("");

  const [showShare, setShowShare] = useState(false);
  const [shareEmail, setShareEmail] = useState("");
  const [shareMessage, setShareMessage] = useState("");

  const userRef = useRef(null);
  const canvasIdRef = useRef(null);
  const contentRef = useRef(EMPTY_CONTENT);
  const dirtyRef = useRef(false);
  const editVersionRef = useRef(0);
  const editsSinceSaveRef = useRef(0);
  const aiSinceSaveRef = useRef(0);
  const saveTimerRef = useRef(null);
  const toastTimerRef = useRef(null);
  const creatingRef = useRef(false);

  userRef.current = user;
  canvasIdRef.current = canvasId;

  function showToast(message) {
    setToast(message);
    clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(""), 4500);
  }

  // ---------- Login state ----------
  useEffect(() => {
    return onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setAuthReady(true);
      setError("");
    });
  }, []);

  // ---------- List of canvases this person can open ----------
  useEffect(() => {
    if (!user) return;

    const myEmail = (user.email || "").toLowerCase();
    const listQuery = query(
      collection(db, "canvases"),
      where("memberEmails", "array-contains", myEmail)
    );

    const unsubscribe = onSnapshot(
      listQuery,
      (snapshot) => {
        const items = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
        items.sort((a, b) => timeValue(b) - timeValue(a));
        setCanvases(items);
        setListReady(true);
      },
      (err) => {
        setError(`Could not load your canvases: ${err.message}. Check your Firestore rules.`);
        setListReady(true);
      }
    );

    return unsubscribe;
  }, [user?.uid]);

  // ---------- Decide which canvas to open first ----------
  useEffect(() => {
    if (!user || !listReady || canvasId) return;

    const fromLink = new URLSearchParams(window.location.search).get("canvas");
    if (fromLink) {
      setCanvasId(fromLink);
      return;
    }
    if (canvases.length > 0) {
      setCanvasId(canvases[0].id);
      return;
    }
    if (!creatingRef.current) {
      creatingRef.current = true;
      createCanvas();
    }
  }, [user?.uid, listReady, canvases.length, canvasId]);

  // ---------- Live connection to the open canvas ----------
  useEffect(() => {
    if (!user || !canvasId) return;

    setCanvasReady(false);
    dirtyRef.current = false;
    editsSinceSaveRef.current = 0;
    aiSinceSaveRef.current = 0;
    setAiPreview(null);
    setError("");
    window.history.replaceState(null, "", `?canvas=${canvasId}`);

    let firstLoad = true;

    const unsubscribe = onSnapshot(
      doc(db, "canvases", canvasId),
      (snapshot) => {
        if (!snapshot.exists()) {
          setError("This canvas was not found. It may have been removed.");
          return;
        }

        if (snapshot.metadata.hasPendingWrites) return;

        const data = snapshot.data();

        setMeta({
          title: data.title || "Untitled canvas",
          ownerUid: data.ownerUid || "",
          ownerEmail: data.ownerEmail || "",
          memberEmails: data.memberEmails || [],
        });
        setTitleDraft(data.title || "Untitled canvas");

        if (!firstLoad && data.lastEditedByUid && data.lastEditedByUid !== user.uid) {
          showToast(`${data.lastEditedByName || data.lastEditedByEmail || "Someone"} changed this canvas`);
        }

        if (!dirtyRef.current) {
          const next = {
            notes: data.notes || "",
            documentText: data.documentText || "",
            tableJson: data.tableJson || "",
            drawJson: data.drawJson || "",
          };
          contentRef.current = next;
          setContent(next);
          setSaveStatus("Saved");
        }

        firstLoad = false;
        setCanvasReady(true);
      },
      () => {
        setError("You do not have access to this canvas, or it no longer exists.");
      }
    );

    return unsubscribe;
  }, [canvasId, user?.uid]);

  // ---------- Analytics history of the open canvas ----------
  useEffect(() => {
    if (!user || !canvasId) return;

    setHistory([]);
    const historyQuery = query(
      collection(db, "canvases", canvasId, "activity"),
      orderBy("date", "desc"),
      limit(7)
    );

    const unsubscribe = onSnapshot(
      historyQuery,
      (snapshot) => setHistory(snapshot.docs.map((item) => item.data())),
      () => setHistory([])
    );

    return unsubscribe;
  }, [canvasId, user?.uid]);

  // ---------- Saving ----------
  function scheduleSave() {
    dirtyRef.current = true;
    editVersionRef.current += 1;
    setSaveStatus("Saving");
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(saveNow, 700);
  }

  async function saveNow() {
    const id = canvasIdRef.current;
    const person = userRef.current;
    if (!id || !person) return;

    clearTimeout(saveTimerRef.current);

    const versionAtStart = editVersionRef.current;
    const edits = editsSinceSaveRef.current;
    const aiPrompts = aiSinceSaveRef.current;
    const current = contentRef.current;
    editsSinceSaveRef.current = 0;
    aiSinceSaveRef.current = 0;

    try {
      await updateDoc(doc(db, "canvases", id), {
        notes: current.notes,
        documentText: current.documentText,
        tableJson: current.tableJson,
        drawJson: current.drawJson,
        editCount: increment(edits),
        lastEditedByUid: person.uid,
        lastEditedByName: person.displayName || "",
        lastEditedByEmail: (person.email || "").toLowerCase(),
        updatedAt: serverTimestamp(),
      });

      await setDoc(
        doc(db, "canvases", id, "activity", todayKey()),
        {
          date: todayKey(),
          edits: increment(edits),
          aiPrompts: increment(aiPrompts),
          words: countWords(current),
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      if (editVersionRef.current === versionAtStart) {
        dirtyRef.current = false;
        setSaveStatus("Saved");
      }
    } catch (err) {
      console.error("Save failed:", err);
      editsSinceSaveRef.current += edits;
      aiSinceSaveRef.current += aiPrompts;
      setSaveStatus("Save failed");
      setError("Your latest changes could not be saved. Check your connection and Firestore rules.");
    }
  }

  function changeContent(field, value) {
    const next = { ...contentRef.current, [field]: value };
    contentRef.current = next;
    setContent(next);
    editsSinceSaveRef.current += 1;
    scheduleSave();
  }

  // ---------- Canvas actions ----------
  async function createCanvas() {
    const person = userRef.current;
    if (!person) return;

    try {
      const myEmail = (person.email || "").toLowerCase();
      const created = await addDoc(collection(db, "canvases"), {
        title: "Untitled canvas",
        ownerUid: person.uid,
        ownerEmail: myEmail,
        memberEmails: [myEmail],
        notes: "",
        documentText: "",
        tableJson: "",
        drawJson: "",
        editCount: 0,
        lastEditedByUid: person.uid,
        lastEditedByName: person.displayName || "",
        lastEditedByEmail: myEmail,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      await openCanvas(created.id);
    } catch (err) {
      setError(`Could not create a canvas: ${err.message}`);
    } finally {
      creatingRef.current = false;
    }
  }

  async function openCanvas(id) {
    if (id === canvasIdRef.current) return;
    if (dirtyRef.current) await saveNow();
    setActiveTab("Notes");
    setCanvasId(id);
  }

  async function renameCanvas() {
    const cleaned = titleDraft.trim() || "Untitled canvas";
    setTitleDraft(cleaned);
    if (cleaned === meta.title || !canvasId) return;
    try {
      await updateDoc(doc(db, "canvases", canvasId), { title: cleaned });
    } catch (err) {
      setError("Could not rename this canvas.");
    }
  }

  // ---------- Sharing ----------
  const isOwner = user ? meta.ownerUid === user.uid : false;

  async function inviteByEmail(event) {
    event.preventDefault();
    const email = shareEmail.trim().toLowerCase();

    if (!/^\S+@\S+\.\S+$/.test(email)) {
      setShareMessage("Please type a valid email address.");
      return;
    }
    if (meta.memberEmails.includes(email)) {
      setShareMessage("This person already has access.");
      return;
    }

    try {
      await updateDoc(doc(db, "canvases", canvasId), {
        memberEmails: arrayUnion(email),
      });
      setShareEmail("");
      setShareMessage(`${email} can now open this canvas. Ask them to sign in with that Gmail, or send them the link.`);
    } catch (err) {
      setShareMessage("Could not add this person. Only the owner can invite.");
    }
  }

  async function removeMember(email) {
    try {
      await updateDoc(doc(db, "canvases", canvasId), {
        memberEmails: arrayRemove(email),
      });
    } catch (err) {
      setShareMessage("Could not remove this person.");
    }
  }

  function copyLink() {
    const link = `${window.location.origin}/?canvas=${canvasId}`;
    navigator.clipboard?.writeText(link);
    setShareMessage("Link copied. They also need to be invited by email.");
  }

  // ---------- Login / logout ----------
  async function handleGoogleLogin() {
    setError("");
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      if (err.code === "auth/popup-closed-by-user") return;
      if (err.code === "auth/unauthorized-domain") {
        setError("This website domain is not authorized in Firebase Authentication.");
      } else {
        setError(`Google sign-in failed: ${err.message}`);
      }
    }
  }

  async function handleLogout() {
    if (dirtyRef.current) await saveNow();
    await signOut(auth);
    setCanvases([]);
    setListReady(false);
    setCanvasId(null);
    setCanvasReady(false);
    setContent(EMPTY_CONTENT);
    contentRef.current = EMPTY_CONTENT;
    setAiPreview(null);
    window.history.replaceState(null, "", "/");
  }

  function goToMyCanvases() {
    window.history.replaceState(null, "", "/");
    setError("");
    setCanvasId(null);
  }

  // ---------- AI ----------
  async function createWithAI(event) {
    event.preventDefault();

    if (!prompt.trim()) {
      setError("Enter a prompt first.");
      return;
    }

    setLoadingAI(true);
    setError("");
    setAiPreview(null);

    const askedTab = activeTab;
    const canvasType = {
      Notes: "document",
      Document: "document",
      Table: "spreadsheet",
      Draw: "drawing",
    }[askedTab];

    try {
      const response = await fetch("http://localhost:5000/api/ai/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: prompt.trim(), canvasType, model }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "AI generation failed.");
      }

      const answer = typeof data.result === "string" ? data.result : JSON.stringify(data.result);

      // The answer waits in a preview. Nothing touches the canvas yet.
      if (askedTab === "Table") {
        setAiPreview({ tab: askedTab, table: parseTable(answer) });
      } else if (askedTab === "Draw") {
        setAiPreview({ tab: askedTab, draw: autoLayout(JSON.parse(answer)) });
      } else {
        setAiPreview({ tab: askedTab, text: answer });
      }

      // Count the prompt in today's analytics.
      aiSinceSaveRef.current += 1;
      scheduleSave();
    } catch (err) {
      setError(err.message || "Could not connect to the AI server.");
    } finally {
      setLoadingAI(false);
    }
  }

  function moveToCanvas() {
    if (!aiPreview) return;

    const before = contentRef.current;
    const next = { ...before };

    if (aiPreview.tab === "Notes") {
      next.notes = [before.notes, aiPreview.text].filter(Boolean).join("\n\n");
    } else if (aiPreview.tab === "Document") {
      next.documentText = [before.documentText, aiPreview.text].filter(Boolean).join("\n\n");
    } else if (aiPreview.tab === "Table") {
      if (
        tableHasWriting(before.tableJson) &&
        !window.confirm("Your table already has writing in it. Replace it with this one?")
      ) {
        return;
      }
      next.tableJson = JSON.stringify(aiPreview.table);
    } else if (aiPreview.tab === "Draw") {
      const current = parseDraw(before.drawJson);
      if (
        current.nodes.length > 0 &&
        !window.confirm("Your drawing already has boxes. Replace them with this diagram?")
      ) {
        return;
      }
      next.drawJson = JSON.stringify({
        nodes: aiPreview.draw.nodes,
        edges: aiPreview.draw.edges,
        strokes: current.strokes,
      });
    }

    contentRef.current = next;
    setContent(next);
    editsSinceSaveRef.current += 1;
    scheduleSave();
    setAiPreview(null);
    showToast("Moved to your canvas");
  }

  const tableData = useMemo(() => parseTable(content.tableJson), [content.tableJson]);
  const drawData = useMemo(() => parseDraw(content.drawJson), [content.drawJson]);

  // ---------- Screens ----------
  if (!authReady) {
    return <div className="auth-screen">Loading {APP_NAME}…</div>;
  }

  if (!user) {
    return (
      <div className="auth-screen">
        <section className="login-card">
          <div className="brand-icon login-brand-icon">✳</div>
          <p className="eyebrow">{APP_TAGLINE.toUpperCase()}</p>
          <h1>Welcome to {APP_NAME}.</h1>
          <p className="subtitle">
            Sign in to save your canvases, share them, and see your workspace activity.
          </p>

          <button className="google-login-button" onClick={handleGoogleLogin}>
            <span className="google-letter">G</span>
            Continue with Google
          </button>

          {error && <p className="error-message">{error}</p>}

          <p className="login-footnote">
            Your canvases are private until you choose to share them.
          </p>
        </section>
      </div>
    );
  }

  if (!canvasReady) {
    return (
      <div className="auth-screen">
        <section className="login-card">
          <h2>Opening your canvas…</h2>
          <p className="subtitle">Loading from the cloud.</p>
          {error && <p className="error-message">{error}</p>}
          {error && (
            <div className="modal-actions">
              <button className="ghost-button" onClick={goToMyCanvases}>
                Go to my canvases
              </button>
              <button className="ghost-button" onClick={handleLogout}>
                Sign out
              </button>
            </div>
          )}
        </section>
      </div>
    );
  }

  const firstLetter = (user.displayName || user.email || "G")[0].toUpperCase();
  const myCanvases = canvases.filter((item) => item.ownerUid === user.uid);
  const sharedCanvases = canvases.filter((item) => item.ownerUid !== user.uid);
  const wordCount = countWords(content);
  const previewHere = aiPreview && aiPreview.tab === activeTab;

  function renderCanvasItem(item) {
    return (
      <button
        key={item.id}
        className={item.id === canvasId ? "canvas-item selected" : "canvas-item"}
        onClick={() => openCanvas(item.id)}
      >
        <span className="canvas-item-title">{item.title || "Untitled canvas"}</span>
        {item.ownerUid !== user.uid && <small>from {item.ownerEmail}</small>}
      </button>
    );
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-icon">✳</span>
          <span className="brand-text">
            <strong>{APP_NAME}</strong>
            <small>{APP_TAGLINE}</small>
          </span>
        </div>

        <div className="title-block">
          <input
            className="title-input"
            value={titleDraft}
            onChange={(event) => setTitleDraft(event.target.value)}
            onBlur={renameCanvas}
            onKeyDown={(event) => event.key === "Enter" && event.currentTarget.blur()}
            aria-label="Canvas name"
          />
          <span className={`status-pill status-${saveStatus.replace(" ", "-").toLowerCase()}`}>
            <span className="status-dot" />
            {saveStatus}
          </span>
        </div>

        <div className="topbar-actions">
          <button className="ghost-button" onClick={() => setShowAnalytics((visible) => !visible)}>
            {showAnalytics ? "Hide analytics" : "Analytics"}
          </button>

          <button
            className="share-button"
            onClick={() => {
              setShareMessage("");
              setShowShare(true);
            }}
          >
            Share
          </button>

          <div className="user-chip" title={user.email}>
            {user.photoURL ? (
              <img className="user-avatar" src={user.photoURL} alt="" />
            ) : (
              <span className="avatar">{firstLetter}</span>
            )}
            <button className="link-button" onClick={handleLogout}>
              Sign out
            </button>
          </div>
        </div>
      </header>

      <div className={showAnalytics ? "layout with-analytics" : "layout"}>
        <aside className="sidebar">
          <button className="new-canvas-button" onClick={createCanvas}>
            + New canvas
          </button>

          <p className="side-heading">MY CANVASES</p>
          {myCanvases.length === 0 && <p className="side-hint">Nothing here yet.</p>}
          {myCanvases.map(renderCanvasItem)}

          {sharedCanvases.length > 0 && (
            <>
              <p className="side-heading">SHARED WITH ME</p>
              {sharedCanvases.map(renderCanvasItem)}
            </>
          )}
        </aside>

        <main className="workspace">
          <section className="canvas-card">
            <div className="tabs" role="tablist" aria-label="Canvas type">
              {TABS.map((tab) => (
                <button
                  key={tab.name}
                  role="tab"
                  aria-selected={activeTab === tab.name}
                  className={activeTab === tab.name ? "tab active-tab" : "tab"}
                  onClick={() => {
                    setActiveTab(tab.name);
                    setError("");
                  }}
                >
                  <span className="tab-icon">{tab.icon}</span>
                  {tab.name}
                </button>
              ))}
            </div>

            <div className="canvas-body">
              {activeTab === "Notes" && (
                <textarea
                  className="writing-area"
                  aria-label="Write your notes"
                  value={content.notes}
                  onChange={(event) => changeContent("notes", event.target.value)}
                  placeholder="Capture a thought, idea or reminder..."
                />
              )}

              {activeTab === "Document" && (
                <textarea
                  className="writing-area document-style"
                  aria-label="Document content"
                  value={content.documentText}
                  onChange={(event) => changeContent("documentText", event.target.value)}
                  placeholder="Start writing your document here..."
                />
              )}

              {activeTab === "Table" && (
                <TableEditor
                  value={tableData}
                  onChange={(next) => changeContent("tableJson", JSON.stringify(next))}
                />
              )}

              {activeTab === "Draw" && (
                <DrawBoard
                  value={drawData}
                  onChange={(next) => changeContent("drawJson", JSON.stringify(next))}
                />
              )}

              {previewHere && (
                <section className="ai-preview">
                  <div className="result-heading">
                    <h3>AI suggestion</h3>
                    <div className="preview-actions">
                      <button className="ghost-button small" onClick={() => setAiPreview(null)}>
                        Discard
                      </button>
                      <button className="primary-button small" onClick={moveToCanvas}>
                        Move to canvas
                      </button>
                    </div>
                  </div>

                  {aiPreview.text !== undefined && <pre>{aiPreview.text}</pre>}

                  {aiPreview.table && (
                    <div className="sheet-scroll">
                      <table className="sheet-table preview-table">
                        <thead>
                          <tr>
                            {aiPreview.table.columns.map((name, i) => (
                              <th key={i}>{name}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {aiPreview.table.rows.map((row, r) => (
                            <tr key={r}>
                              {row.map((cell, c) => (
                                <td key={c}>{cell}</td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {aiPreview.draw && (
                    <DrawBoard value={aiPreview.draw} readOnly compact markerId="arrow-preview" />
                  )}
                </section>
              )}
            </div>
          </section>

          <section className="prompt-dock">
            <form onSubmit={createWithAI}>
              <div className="prompt-top">
                <span className="ai-label">✳ ASK AI FOR {activeTab.toUpperCase()}</span>
                <select
                  aria-label="AI model"
                  value={model}
                  onChange={(event) => setModel(event.target.value)}
                >
                  {MODELS.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </div>

              <textarea
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder={`Try: ${PROMPT_IDEAS[activeTab]}`}
                rows={2}
              />

              {error && <p className="error-message">{error}</p>}

              <div className="prompt-footer">
                <button
                  type="button"
                  className="ghost-button small"
                  onClick={() => setPrompt(PROMPT_IDEAS[activeTab])}
                >
                  Use an example
                </button>
                <button type="submit" className="primary-button" disabled={loadingAI}>
                  {loadingAI ? "Creating…" : "Create with AI"}
                </button>
              </div>
            </form>
          </section>
        </main>

        {showAnalytics && (
          <AnalyticsPanel
            history={history}
            wordCount={wordCount}
            saveStatus={saveStatus}
            memberCount={meta.memberEmails.length}
            canvasTitle={meta.title}
          />
        )}
      </div>

      {toast && <div className="toast">{toast}</div>}

      {showShare && (
        <div className="modal-backdrop" onClick={() => setShowShare(false)}>
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-head">
              <h2>Share “{meta.title}”</h2>
              <button className="icon-button" onClick={() => setShowShare(false)} aria-label="Close">
                ×
              </button>
            </div>

            {isOwner ? (
              <form onSubmit={inviteByEmail}>
                <label htmlFor="share-email">Invite by email</label>
                <div className="share-row">
                  <input
                    id="share-email"
                    type="email"
                    value={shareEmail}
                    onChange={(event) => setShareEmail(event.target.value)}
                    placeholder="friend@gmail.com"
                  />
                  <button type="submit" className="primary-button" disabled={!shareEmail.trim()}>
                    Invite
                  </button>
                </div>
              </form>
            ) : (
              <p className="modal-note">Only the owner of this canvas can invite people.</p>
            )}

            {shareMessage && <p className="modal-note">{shareMessage}</p>}

            <p className="member-heading">People with access</p>
            {meta.memberEmails.map((email) => (
              <div className="member-row" key={email}>
                <span>
                  {email}
                  {email === meta.ownerEmail && <em> (owner)</em>}
                </span>
                {isOwner && email !== meta.ownerEmail && (
                  <button className="link-button" onClick={() => removeMember(email)}>
                    Remove
                  </button>
                )}
              </div>
            ))}

            <div className="modal-actions">
              <button className="ghost-button" onClick={copyLink}>
                Copy link
              </button>
            </div>

            <p className="modal-note">
              {APP_NAME} does not send an email by itself. The person signs in with the invited
              Gmail and the canvas appears under “Shared with me”.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}