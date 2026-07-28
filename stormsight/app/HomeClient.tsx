"use client";

import { useState } from "react";
import nextDynamic from "next/dynamic";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import type { Hazard, Volunteer } from "./DisasterMap";
import {
  findNearestShelter,
  findMatchingVolunteers,
  checkVerification,
  checkRouteForBlockedRoads,
  TAMPA_NEIGHBORHOODS,
  SHELTERS,
} from "./DisasterMap";

// Load the map only in the browser (not on the server)
const DisasterMap = nextDynamic(() => import("./DisasterMap"), { ssr: false });

const SKILL_OPTIONS = [
  { value: "medical", label: "Medical" },
  { value: "boat_rescue", label: "Boat Rescue" },
  { value: "firefighting", label: "Firefighting" },
  { value: "chainsaw", label: "Chainsaw / Debris Removal" },
  { value: "electrician", label: "Electrician" },
  { value: "construction", label: "Construction" },
  { value: "search_and_rescue", label: "Search & Rescue" },
  { value: "heavy_equipment", label: "Heavy Equipment Operator" },
  { value: "traffic_support", label: "Traffic Support" },
  { value: "supplies", label: "Supply Delivery" },
  { value: "evacuation_support", label: "Evacuation Support" },
];

const NEIGHBORHOOD_OPTIONS = Object.keys(TAMPA_NEIGHBORHOODS);

// Semantic hazard colors — used ONLY to encode meaning (dots, chart, table),
// never as decoration elsewhere in the UI.
const HAZARD_COLORS: Record<string, string> = {
  flood: "#7C93FF",
  fire: "#F0555A",
  downed_tree: "#34D399",
  damaged_building: "#F0A63A",
  blocked_road: "#E8B93F",
  none: "#5B6675",
};

type RouteResult = {
  start: [number, number];
  end: [number, number];
  blocked: boolean;
  blockageCount: number;
};

export default function HomeClient() {
  const [image, setImage] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [hazards, setHazards] = useState<Hazard[]>([]);
  const [nearestShelterInfo, setNearestShelterInfo] = useState<string | null>(null);
  const [estimatedCost, setEstimatedCost] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [showIntro, setShowIntro] = useState(true);
  const [currentView, setCurrentView] = useState<"report" | "dashboard" | "volunteers" | "routes">("dashboard");
  const [verificationInfo, setVerificationInfo] = useState<{
    verified: boolean;
    reportCount: number;
  } | null>(null);

  // Voice recording state
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [mediaRecorder, setMediaRecorder] = useState<MediaRecorder | null>(null);

  // Directions state
  const [myLocation, setMyLocation] = useState(NEIGHBORHOOD_OPTIONS[0]);
  const [destinationShelterId, setDestinationShelterId] = useState(SHELTERS[0].id);
  const [route, setRoute] = useState<RouteResult | null>(null);

  // Volunteer state
  const [volunteers, setVolunteers] = useState<Volunteer[]>([]);
  const [volunteerName, setVolunteerName] = useState("");
  const [volunteerSkill, setVolunteerSkill] = useState("medical");
  const [volunteerContact, setVolunteerContact] = useState("");
  const [volunteerNeighborhood, setVolunteerNeighborhood] = useState(
    NEIGHBORHOOD_OPTIONS[0]
  );
  const [matchedVolunteers, setMatchedVolunteers] = useState<Volunteer[]>([]);

  async function startRecording() {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const recorder = new MediaRecorder(stream);
    const chunks: BlobPart[] = [];

    recorder.ondataavailable = (e) => chunks.push(e.data);
    recorder.onstop = async () => {
      const blob = new Blob(chunks, { type: "audio/webm" });
      setAudioBlob(blob);
      await transcribeAudio(blob);
    };

    recorder.start();
    setMediaRecorder(recorder);
    setIsRecording(true);
  }

  function stopRecording() {
    mediaRecorder?.stop();
    setIsRecording(false);
  }

  async function transcribeAudio(blob: Blob) {
    setTranscribing(true);
    const formData = new FormData();
    formData.append("audio", blob, "recording.webm");

    const response = await fetch("/api/transcribe", {
      method: "POST",
      body: formData,
    });

    const data = await response.json();
    if (data.text) {
      setNotes((prev) => (prev ? prev + " " + data.text : data.text));
    }
    setTranscribing(false);
  }

  function handleGetDirections() {
    const start = TAMPA_NEIGHBORHOODS[myLocation];
    const destination = SHELTERS.find((s) => s.id === destinationShelterId);
    if (!start || !destination) return;

    const { hasBlockages, blockages } = checkRouteForBlockedRoads(
      start.lat,
      start.lng,
      destination.lat,
      destination.lng,
      hazards
    );

    setRoute({
      start: [start.lat, start.lng],
      end: [destination.lat, destination.lng],
      blocked: hasBlockages,
      blockageCount: blockages.length,
    });
  }

  function handleVolunteerSignup() {
    if (!volunteerName.trim() || !volunteerContact.trim()) return;

    const coords = TAMPA_NEIGHBORHOODS[volunteerNeighborhood];

    const newVolunteer: Volunteer = {
      id: Date.now(),
      name: volunteerName,
      skill: volunteerSkill,
      contact: volunteerContact,
      neighborhood: volunteerNeighborhood,
      lat: coords.lat,
      lng: coords.lng,
    };

    setVolunteers((prev) => [...prev, newVolunteer]);
    setVolunteerName("");
    setVolunteerContact("");
  }

  function handleFileSelect(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    setResult(null);

    const reader = new FileReader();
    reader.onloadend = () => {
      setImage(reader.result as string);
    };
    reader.readAsDataURL(file);
  }

  // Turns the AI's text answer into a hazard object we can show on the map
  function parseHazard(text: string) {
    const typeMatch = text.match(/hazard_type:\s*([a-z_]+)/i);
    const severityMatch = text.match(/severity:\s*([a-z]+)/i);
    const descMatch = text.match(/description:\s*(.+)/i);
    const costMatch = text.match(/estimated_cost:\s*(.+)/i);

    return {
      type: typeMatch ? typeMatch[1].toLowerCase() : "none",
      severity: severityMatch ? severityMatch[1].toLowerCase() : "unknown",
      description: descMatch ? descMatch[1].trim() : "No description available.",
      estimatedCost: costMatch ? costMatch[1].trim() : "Unable to estimate",
    };
  }

  async function handleSubmit() {
    if (!image) return;
    setLoading(true);
    setResult(null);
    setMatchedVolunteers([]);
    setVerificationInfo(null);
    setEstimatedCost(null);

    const response = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imageBase64: image, notes }),
    });

    const data = await response.json();
    const text = data.result || "";
    setResult(text);

    const parsed = parseHazard(text);
    setEstimatedCost(parsed.estimatedCost);

    // Random nearby location around Tampa, for demo purposes
    const newLat = 27.9506 + (Math.random() - 0.5) * 0.08;
    const newLng = -82.4572 + (Math.random() - 0.5) * 0.08;

    // Check verification against existing hazards BEFORE adding this new one
    const { verified, reportCount } = checkVerification(
      newLat,
      newLng,
      parsed.type,
      hazards
    );
    setVerificationInfo({ verified, reportCount });

    const newHazard: Hazard = {
      id: Date.now(),
      lat: newLat,
      lng: newLng,
      type: parsed.type,
      severity: parsed.severity,
      description: parsed.description,
      verified,
      reportCount,
    };

    setHazards((prev) => [...prev, newHazard]);

    // Find nearest shelter to this new hazard
    const { shelter, distance } = findNearestShelter(newLat, newLng);
    setNearestShelterInfo(
      `Nearest shelter: ${shelter.name} (${distance.toFixed(
        1
      )} miles away) — ${shelter.currentOccupancy}/${shelter.capacity} occupied`
    );

    // Find matching volunteers for this hazard type
    const matches = findMatchingVolunteers(parsed.type, volunteers);
    setMatchedVolunteers(matches);

    setLoading(false);
  }

  // ---------------- LANDING ----------------
  if (showIntro) {
    return (
      <main className="min-h-screen bg-[var(--bg)] text-[var(--text-primary)] flex flex-col relative overflow-hidden">
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            backgroundImage:
              "linear-gradient(rgba(45,212,191,0.035) 1px, transparent 1px), linear-gradient(90deg, rgba(45,212,191,0.035) 1px, transparent 1px)",
            backgroundSize: "56px 56px",
            maskImage: "radial-gradient(1000px 500px at 78% 10%, black, transparent 70%)",
          }}
        />

        {/* Top nav */}
        <nav className="relative z-10 flex items-center justify-between px-8 py-5">
          <div className="flex items-center gap-2.5">
            <BrandMark />
            <span className="font-display font-semibold text-lg">StormSight</span>
            <span className="font-mono text-[10px] text-[var(--text-muted)] bg-[var(--surface)] border border-[var(--border)] px-2 py-0.5 rounded-full ml-1">
              v1.0
            </span>
          </div>
          <button
            onClick={() => setShowIntro(false)}
            className="font-display font-medium bg-[var(--surface)] border border-[var(--border-strong)] text-[var(--text-primary)] px-5 py-2 rounded-lg text-sm transition-all duration-200 hover:bg-[var(--surface-hover)] hover:border-[var(--accent)] hover:text-[var(--accent-text)] hover:-translate-y-0.5"
          >
            Dashboard →
          </button>
        </nav>

        {/* Hero content */}
        <div className="relative z-10 flex-1 grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-10 items-center px-8 max-w-6xl mx-auto w-full">
        <div className="max-w-3xl">
          <div className="inline-flex items-center gap-2 mb-4 font-mono text-xs text-[var(--accent-text)] bg-[var(--accent-dim)] border border-[#1E4A45] pl-2.5 pr-3 py-1.5 rounded-full w-fit">
            <span className="relative w-1.5 h-1.5 rounded-full bg-[var(--accent)]">
              <span className="absolute inset-[-4px] rounded-full border border-[var(--accent)] dl-ring-pulse" />
            </span>
            AI disaster intelligence · Tampa Bay
          </div>

          <h1 className="font-display font-bold text-6xl mb-6 leading-tight tracking-tight">
            Storm
            <span className="text-[var(--accent-text)]">Sight</span>
          </h1>

          <p className="text-[var(--text-primary)] text-lg mb-2 max-w-xl font-medium">
            When disaster strikes, every second matters.
          </p>
          <p className="text-[var(--text-secondary)] mb-10 max-w-xl leading-relaxed">
            StormSight turns community-submitted photos and voice reports
            into <strong className="text-[var(--text-primary)] font-medium">real-time emergency intelligence </strong>
            — helping responders
            identify hazards, locate shelters, and save lives faster.{" "}
            
          </p>

          <div className="flex gap-4 mb-10">
            <button
              onClick={() => setShowIntro(false)}
              className="font-display font-semibold bg-[var(--accent)] text-[#04211E] px-8 py-3 rounded-lg text-lg transition-all duration-200 hover:bg-[var(--accent-text)] hover:-translate-y-0.5 hover:shadow-[0_8px_30px_-4px_rgba(45,212,191,0.45)]"
            >
              Launch dashboard →
            </button>
          </div>


          {/* Feature badges */}
          <div className="flex flex-wrap gap-2.5">
            <FeatureChip label="Hazard analyzer" color="#2DD4BF" />
            <FeatureChip label="Verification agent" color="#34D399" />
            <FeatureChip label="Resource coordinator" color="#7C93FF" />
            <FeatureChip label="Route advisor" color="#F0A63A" />
          </div>
        </div>

        {/* Radar illustration */}
        <div className="hidden lg:flex relative aspect-square rounded-full border border-[var(--border)] items-center justify-center">
          <div className="absolute inset-[15%] rounded-full border border-[var(--border)]" />
          <div className="absolute inset-[32%] rounded-full border border-[var(--border)]" />
          <div className="absolute inset-[49%] rounded-full border border-[var(--border)]" />
          <div className="absolute inset-0 rounded-full overflow-hidden dl-sweep">
            <div
              className="absolute inset-0"
              style={{ background: "conic-gradient(from 0deg, rgba(45,212,191,0.28), transparent 26%)" }}
            />
          </div>
          <div
            className="w-2.5 h-2.5 rounded-full bg-[var(--accent)]"
            style={{ boxShadow: "0 0 0 6px var(--accent-dim)" }}
          />
          <div className="absolute w-[7px] h-[7px] rounded-full" style={{ top: "28%", left: "62%", background: "#F0555A", boxShadow: "0 0 0 5px #2A1315" }} />
          <div className="absolute w-[7px] h-[7px] rounded-full" style={{ top: "60%", left: "33%", background: "#F0A63A", boxShadow: "0 0 0 5px #2E220D" }} />
          <div className="absolute w-[7px] h-[7px] rounded-full" style={{ top: "44%", left: "74%", background: "#7C93FF", boxShadow: "0 0 0 5px #161B33" }} />
        </div>
        </div>

        {/* Bottom ticker */}
        <div className="relative z-10 bg-[var(--warning-dim)] border-t border-[#4A340F] px-6 py-2.5 text-xs text-[var(--warning-text)] font-mono flex items-center gap-3 overflow-hidden">
          <span className="text-[10px] font-medium text-[var(--warning)] bg-[#1a1206] border border-[#4A340F] px-2 py-0.5 rounded flex-shrink-0">
            SIM
          </span>
          <span className="whitespace-nowrap">
            Simulation active — hurricane demo scenario · Tampa Bay region ·
          </span>
        </div>
      </main>
    );
  }

  // Data prep for the dashboard
  const criticalCount = hazards.filter((h) => h.severity === "high").length;
  const verifiedCount = hazards.filter((h) => h.verified).length;
  const totalCapacity = SHELTERS.reduce((sum, s) => sum + s.capacity, 0);
  const totalOccupied = SHELTERS.reduce((sum, s) => sum + s.currentOccupancy, 0);
  const capacityPercent =
    totalCapacity > 0 ? Math.round((totalOccupied / totalCapacity) * 100) : 0;

  const chartData = hazards.map((h, i) => ({
    name: `Report ${i + 1}`,
    reports: i + 1,
  }));

  // ---------------- APP SHELL ----------------
  return (
    <main className="min-h-screen bg-[var(--bg)] text-[var(--text-primary)] flex">
      {/* Sidebar */}
      <aside className="w-56 bg-[var(--bg-elevated)] border-r border-[var(--border)] flex flex-col p-4 flex-shrink-0">
        <button
          onClick={() => setShowIntro(true)}
          className="flex items-center gap-2.5 mb-6 pb-[18px] border-b border-[var(--border)] text-left hover:opacity-85 transition"
        >
          <BrandMark />
          <div>
            <p className="font-display font-semibold text-[14.5px] leading-tight">StormSight</p>
            <p className="font-mono text-[10px] text-[var(--text-muted)]">Tampa Bay · v1.0</p>
          </div>
        </button>

        <nav className="flex flex-col gap-0.5">
          <SidebarButton
            active={currentView === "dashboard"}
            onClick={() => setCurrentView("dashboard")}
            label="Dashboard"
            icon={<path d="M4 19h16M6 19V9l6-5 6 5v10M10 19v-6h4v6" />}
          />
          <SidebarButton
            active={currentView === "report"}
            onClick={() => setCurrentView("report")}
            label="Report & respond"
            icon={
              <>
                <circle cx="12" cy="13" r="4" />
                <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
              </>
            }
          />
          <SidebarButton
            active={currentView === "volunteers"}
            onClick={() => setCurrentView("volunteers")}
            label="Volunteers"
            icon={<path d="M12 21s-7-4.35-9.5-9C1 8 3 4 7 4c2 0 4 1.5 5 3 1-1.5 3-3 5-3 4 0 6 4 4.5 8-2.5 4.65-9.5 9-9.5 9z" />}
          />
          <SidebarButton
            active={currentView === "routes"}
            onClick={() => setCurrentView("routes")}
            label="Routes"
            icon={
              <>
                <circle cx="12" cy="12" r="9" />
                <path d="M12 7v5l3 3" />
              </>
            }
          />
        </nav>

        <div className="mt-auto pt-4 border-t border-[var(--border)]">
          <button
            onClick={() => setShowIntro(true)}
            className="text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] px-2 transition"
          >
            ← Back to landing
          </button>
        </div>
      </aside>

      {/* Main content area */}
      <div className="relative flex-1 flex flex-col min-w-0">
        {/* Decorative background texture — fills the empty black space behind cards */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            backgroundImage:
              "linear-gradient(rgba(45,212,191,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(45,212,191,0.03) 1px, transparent 1px)",
            backgroundSize: "48px 48px",
          }}
        />
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              "radial-gradient(900px 500px at 85% -10%, rgba(45,212,191,0.06), transparent 60%), radial-gradient(700px 400px at -5% 100%, rgba(124,147,255,0.05), transparent 60%)",
          }}
        />

        <div className="relative z-10 flex flex-col min-w-0 flex-1">
        {/* Simulation banner */}
        <div className="bg-[var(--warning-dim)] border-b border-[#4A340F] px-6 py-2.5 text-xs font-mono text-[var(--warning-text)] flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-[var(--warning)] dl-pulse-dot"></span>
          SIMULATION MODE — hurricane demo scenario, Tampa Bay region
        </div>

        <div className="p-8 overflow-y-auto">
          <div className="max-w-6xl mx-auto">
            {currentView === "dashboard" && (
              <DashboardView
                hazards={hazards}
                volunteers={volunteers}
                criticalCount={criticalCount}
                verifiedCount={verifiedCount}
                capacityPercent={capacityPercent}
                totalOccupied={totalOccupied}
                totalCapacity={totalCapacity}
                chartData={chartData}
              />
            )}

            {currentView === "report" && (
              <>
                <h1 className="font-display font-semibold text-[26px] text-center mb-2.5">
                  Report &amp; respond
                </h1>
                <p className="text-[var(--text-secondary)] mb-8 text-center max-w-md mx-auto text-[14.5px] leading-relaxed">
                  Upload a photo or record a voice note from a
                  hurricane-affected area. Our AI will identify the hazard
                  and add it to the live map.
                </p>

                <div className="flex flex-col lg:flex-row gap-6">
                  {/* Upload panel */}
                  <div className="w-full lg:w-1/3">
                    <div className="border border-dashed border-[var(--border-strong)] bg-[var(--surface)] rounded-xl p-8 text-center">
                      <p className="text-[var(--text-secondary)] mb-4 text-[13.5px]">
                        Choose a photo to analyze
                      </p>

                      <label className="inline-block font-display font-semibold bg-[var(--accent)] text-[#04211E] px-5 py-2.5 rounded-lg cursor-pointer transition hover:bg-[var(--accent-text)] text-[13.5px]">
                        Choose file
                        <input
                          type="file"
                          accept="image/*"
                          onChange={handleFileSelect}
                          className="hidden"
                        />
                      </label>

                      <p className="mt-3 text-xs text-[var(--text-muted)]">
                        {fileName ? fileName : "No file chosen"}
                      </p>

                      {image && (
                        <img
                          src={image}
                          alt="Uploaded preview"
                          className="mt-6 rounded-lg max-h-64 mx-auto border border-[var(--border)]"
                        />
                      )}

                      {image && (
                        <>
                          <textarea
                            value={notes}
                            onChange={(e) => setNotes(e.target.value)}
                            placeholder="Add details: exact location, what's happening, who needs help..."
                            className="mt-4 w-full bg-[var(--bg-elevated)] border border-[var(--border-strong)] rounded-lg p-3 text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] resize-none"
                            rows={3}
                          />

                          <button
                            onClick={isRecording ? stopRecording : startRecording}
                            disabled={transcribing}
                            className={`mt-2 w-full px-4 py-2.5 rounded-lg text-sm font-medium transition font-display ${
                              isRecording
                                ? "bg-[var(--danger)] text-white animate-pulse"
                                : "bg-[var(--bg-elevated)] border border-[var(--border-strong)] text-[var(--text-primary)] hover:bg-[var(--surface-hover)]"
                            }`}
                          >
                            {transcribing
                              ? "Transcribing…"
                              : isRecording
                              ? "⏹ Stop recording"
                              : "🎤 Record voice note"}
                          </button>
                        </>
                      )}

                      {image && (
                        <button
                          onClick={handleSubmit}
                          disabled={loading}
                          className="mt-6 font-display font-semibold bg-[var(--info)] disabled:bg-[var(--border-strong)] disabled:text-[var(--text-muted)] text-[#0B1220] px-6 py-2.5 rounded-lg transition text-[13.5px]"
                        >
                          {loading ? "Analyzing…" : "Submit for analysis"}
                        </button>
                      )}

                      {result && (
                        <pre className="mt-6 text-left text-xs bg-[var(--bg-elevated)] border border-[var(--border)] p-4 rounded-lg whitespace-pre-wrap text-[var(--text-secondary)] font-mono">
                          {result}
                        </pre>
                      )}

                      {verificationInfo && (
                        <div
                          className={`mt-4 text-left text-sm p-4 rounded-lg border ${
                            verificationInfo.verified
                              ? "bg-[var(--success-dim)] border-[#1B4A38] text-[var(--success-text)]"
                              : "bg-[var(--warning-dim)] border-[#4A340F] text-[var(--warning-text)]"
                          }`}
                        >
                          {verificationInfo.verified
                            ? `✅ Verified — confirmed by ${verificationInfo.reportCount} independent reports in this area`
                            : "⚠️ Unverified — only 1 report so far. Will auto-upgrade if others report nearby."}
                        </div>
                      )}

                      {nearestShelterInfo && (
                        <div className="mt-4 text-left text-sm bg-[var(--purple-dim)] border border-[#3C2470] text-[#D6C3FA] p-4 rounded-lg">
                          🏠 {nearestShelterInfo}
                        </div>
                      )}

                      {estimatedCost && (
                        <div className="mt-4 text-left text-sm bg-[var(--surface)] border border-[var(--border)] p-4 rounded-lg">
                          <p className="text-[var(--accent-text)] font-semibold mb-1">
                            💰 Estimated damage cost
                          </p>
                          <p className="text-[var(--text-secondary)]">{estimatedCost}</p>
                          <p className="text-xs text-[var(--text-muted)] mt-1">
                            Rough AI visual estimate — not a professional
                            appraisal
                          </p>
                        </div>
                      )}

                      {matchedVolunteers.length > 0 && (
                        <div className="mt-4 text-left text-sm bg-[var(--surface)] border border-[var(--border)] p-4 rounded-lg">
                          <p className="font-semibold text-[var(--accent-text)] mb-2">
                            🤝 Matched volunteers
                          </p>
                          {matchedVolunteers.map((v) => (
                            <div key={v.id} className="text-[var(--text-secondary)] mb-2">
                              <p className="font-medium text-[var(--text-primary)]">
                                {v.name}
                              </p>
                              <p className="text-xs text-[var(--text-muted)]">
                                {v.skill.replace("_", " ")} ·{" "}
                                {v.neighborhood}
                              </p>
                              <p className="text-xs text-[var(--success-text)]">
                                📞 {v.contact}
                              </p>
                            </div>
                          ))}
                        </div>
                      )}

                      {result && matchedVolunteers.length === 0 && (
                        <div className="mt-4 text-left text-sm bg-[var(--surface)] border border-[var(--border)] p-4 rounded-lg text-[var(--text-muted)]">
                          🤝 No matching volunteers signed up yet for this
                          hazard type.
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Map panel */}
                  <div className="w-full lg:w-2/3">
                    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl overflow-hidden">
                      <DisasterMap
                        hazards={hazards}
                        volunteers={volunteers}
                        route={route}
                      />
                      {/* Legend */}
                      <div className="flex flex-wrap gap-x-[18px] gap-y-2 px-[22px] py-4 border-t border-[var(--border)] text-sm">
                        <LegendItem color="#7C93FF" label="Flood" />
                        <LegendItem color="#F0555A" label="Fire" />
                        <LegendItem color="#34D399" label="Downed tree" />
                        <LegendItem color="#F0A63A" label="Damaged building" />
                        <LegendItem color="#E8B93F" label="Blocked road" />
                        <LegendItem color="#8B5CF6" label="Shelter" />
                        <LegendItem color="#5EEAD4" label="Volunteer" />
                      </div>
                    </div>
                  </div>
                </div>
              </>
            )}

            {currentView === "volunteers" && (
              <>
                <h1 className="font-display font-semibold text-[26px] text-center mb-2.5">
                  Volunteers
                </h1>
                <p className="text-[var(--text-secondary)] mb-8 text-center max-w-md mx-auto text-[14.5px] leading-relaxed">
                  Sign up to help, and see who&apos;s already registered to
                  respond in each neighborhood.
                </p>

                <div className="flex flex-col lg:flex-row gap-6">
                  {/* Sign-up panel */}
                  <div className="w-full lg:w-1/3">
                    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-6">
                      <p className="font-display font-semibold text-[15px] mb-4">
                        Want to help? Sign up as a volunteer
                      </p>

                      <input
                        type="text"
                        value={volunteerName}
                        onChange={(e) => setVolunteerName(e.target.value)}
                        placeholder="Your name"
                        className="w-full bg-[var(--bg-elevated)] border border-[var(--border-strong)] rounded-lg p-2.5 text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] mb-3"
                      />

                      <input
                        type="text"
                        value={volunteerContact}
                        onChange={(e) => setVolunteerContact(e.target.value)}
                        placeholder="Phone or email"
                        className="w-full bg-[var(--bg-elevated)] border border-[var(--border-strong)] rounded-lg p-2.5 text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] mb-3"
                      />

                      <select
                        value={volunteerNeighborhood}
                        onChange={(e) =>
                          setVolunteerNeighborhood(e.target.value)
                        }
                        className="w-full bg-[var(--bg-elevated)] border border-[var(--border-strong)] rounded-lg p-2.5 text-sm text-[var(--text-primary)] mb-3"
                      >
                        {NEIGHBORHOOD_OPTIONS.map((n) => (
                          <option key={n} value={n}>
                            {n}
                          </option>
                        ))}
                      </select>

                      <select
                        value={volunteerSkill}
                        onChange={(e) => setVolunteerSkill(e.target.value)}
                        className="w-full bg-[var(--bg-elevated)] border border-[var(--border-strong)] rounded-lg p-2.5 text-sm text-[var(--text-primary)] mb-3"
                      >
                        {SKILL_OPTIONS.map((s) => (
                          <option key={s.value} value={s.value}>
                            {s.label}
                          </option>
                        ))}
                      </select>

                      <button
                        onClick={handleVolunteerSignup}
                        className="w-full font-display font-semibold bg-[var(--accent)] text-[#04211E] px-4 py-2.5 rounded-lg transition hover:bg-[var(--accent-text)] text-sm"
                      >
                        Sign up
                      </button>
                    </div>
                  </div>

                  {/* Registered volunteers list */}
                  <div className="w-full lg:w-2/3">
                    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-6">
                      <p className="font-display font-semibold text-[15px] mb-4 flex items-center gap-2">
                        Registered volunteers
                        <span className="inline-flex items-center justify-center min-w-[22px] h-5 px-1.5 rounded bg-[var(--bg-elevated)] border border-[var(--border-strong)] font-mono text-xs text-[var(--text-secondary)]">
                          {volunteers.length}
                        </span>
                      </p>

                      {volunteers.length === 0 ? (
                        <p className="text-[var(--text-muted)] text-sm">
                          No volunteers signed up yet.
                        </p>
                      ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          {volunteers.map((v) => (
                            <div
                              key={v.id}
                              className="bg-[var(--bg-elevated)] border border-[var(--border)] rounded-lg p-4"
                            >
                              <p className="font-medium text-[var(--text-primary)]">
                                {v.name}
                              </p>
                              <p className="text-xs text-[var(--text-muted)] mt-1">
                                {v.skill.replace("_", " ")} · {v.neighborhood}
                              </p>
                              <p className="text-xs text-[var(--success-text)] mt-1">
                                📞 {v.contact}
                              </p>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </>
            )}

            {currentView === "routes" && (
              <>
                <h1 className="font-display font-semibold text-[26px] text-center mb-2.5">
                  Routes
                </h1>
                <p className="text-[var(--text-secondary)] mb-8 text-center max-w-md mx-auto text-[14.5px] leading-relaxed">
                  Get directions to the nearest shelter, with warnings if a
                  reported hazard is blocking the way.
                </p>

                <div className="flex flex-col lg:flex-row gap-6">
                  {/* Directions panel */}
                  <div className="w-full lg:w-1/3">
                    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-6">
                      <p className="font-display font-semibold text-[15px] mb-4 flex items-center gap-2">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-[17px] h-[17px] text-[var(--accent-text)]">
                          <circle cx="12" cy="12" r="9" />
                          <path d="M12 7v5l3 3" />
                        </svg>
                        Get directions to a shelter
                      </p>

                      <label className="text-xs text-[var(--text-secondary)] mb-1.5 block">
                        Your location
                      </label>
                      <select
                        value={myLocation}
                        onChange={(e) => setMyLocation(e.target.value)}
                        className="w-full bg-[var(--bg-elevated)] border border-[var(--border-strong)] rounded-lg p-2.5 text-sm text-[var(--text-primary)] mb-3"
                      >
                        {NEIGHBORHOOD_OPTIONS.map((n) => (
                          <option key={n} value={n}>
                            {n}
                          </option>
                        ))}
                      </select>

                      <label className="text-xs text-[var(--text-secondary)] mb-1.5 block">
                        Destination shelter
                      </label>
                      <select
                        value={destinationShelterId}
                        onChange={(e) =>
                          setDestinationShelterId(Number(e.target.value))
                        }
                        className="w-full bg-[var(--bg-elevated)] border border-[var(--border-strong)] rounded-lg p-2.5 text-sm text-[var(--text-primary)] mb-3"
                      >
                        {SHELTERS.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </select>

                      <button
                        onClick={handleGetDirections}
                        className="w-full font-display font-semibold bg-[var(--accent)] text-[#04211E] px-4 py-2.5 rounded-lg transition hover:bg-[var(--accent-text)] text-sm"
                      >
                        Get directions
                      </button>

                      {route && (
                        <div
                          className={`mt-4 text-sm p-3 rounded-lg border ${
                            route.blocked
                              ? "bg-[var(--danger-dim)] border-[#4A1E20] text-[var(--danger-text)]"
                              : "bg-[var(--success-dim)] border-[#1B4A38] text-[var(--success-text)]"
                          }`}
                        >
                          {route.blocked
                            ? `⚠️ Warning: ${route.blockageCount} blocked road${
                                route.blockageCount > 1 ? "s" : ""
                              } reported near this route. Consider an alternative shelter.`
                            : "✅ Route looks clear — no reported blockages nearby."}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Map showing the route */}
                  <div className="w-full lg:w-2/3">
                    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl overflow-hidden">
                      <DisasterMap
                        hazards={hazards}
                        volunteers={volunteers}
                        route={route}
                      />
                      <div className="flex flex-wrap gap-x-[18px] gap-y-2 px-[22px] py-4 border-t border-[var(--border)] text-sm">
                        <LegendItem color="#7C93FF" label="Flood" />
                        <LegendItem color="#F0555A" label="Fire" />
                        <LegendItem color="#34D399" label="Downed tree" />
                        <LegendItem color="#F0A63A" label="Damaged building" />
                        <LegendItem color="#E8B93F" label="Blocked road" />
                        <LegendItem color="#8B5CF6" label="Shelter" />
                      </div>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
        </div>
      </div>
    </main>
  );
}

function DashboardView({
  hazards,
  volunteers,
  criticalCount,
  verifiedCount,
  capacityPercent,
  totalOccupied,
  totalCapacity,
  chartData,
}: {
  hazards: Hazard[];
  volunteers: Volunteer[];
  criticalCount: number;
  verifiedCount: number;
  capacityPercent: number;
  totalOccupied: number;
  totalCapacity: number;
  chartData: { name: string; reports: number }[];
}) {
  return (
    <div>
      <h1 className="font-display font-semibold text-[26px] mb-1.5 tracking-tight">
        Command dashboard
      </h1>
      <p className="text-[var(--text-secondary)] mb-7 text-[14.5px]">
        Tampa Bay region · Emergency response overview
      </p>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5 mb-8">
        <StatCard
          label="Active hazards"
          value={hazards.length.toString()}
          sublabel={`${criticalCount} high severity`}
          accent="var(--danger)"
          valueColor="var(--danger-text)"
        />
        <StatCard
          label="Verified reports"
          value={verifiedCount.toString()}
          sublabel={`of ${hazards.length} total reports`}
          accent="var(--success)"
          valueColor="var(--success-text)"
        />
        <StatCard
          label="Shelter capacity"
          value={`${capacityPercent}%`}
          sublabel={`${totalOccupied} / ${totalCapacity} occupied`}
          accent="var(--info)"
          valueColor="#B7C2FF"
        />
        <StatCard
          label="Volunteers ready"
          value={volunteers.length.toString()}
          sublabel="registered responders"
          accent="var(--accent)"
          valueColor="var(--accent-text)"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
        {/* Hazard reports over time chart */}
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-6">
          <p className="font-display font-semibold text-[15px] mb-4">
            Reports over time
          </p>
          {chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#232C38" />
                <XAxis dataKey="name" stroke="#8A97A8" fontSize={12} />
                <YAxis stroke="#8A97A8" fontSize={12} allowDecimals={false} />
                <Tooltip
                  contentStyle={{
                    background: "#141B26",
                    border: "1px solid #232C38",
                    borderRadius: 8,
                    color: "#EDF2F7",
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="reports"
                  stroke="#2DD4BF"
                  strokeWidth={2}
                />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-[var(--text-muted)] text-[13.5px] border border-dashed border-[var(--border-strong)] rounded-lg h-[150px] flex items-center justify-center text-center px-4">
              No reports yet — submit a photo in &quot;Report &amp; respond&quot; to see
              data here.
            </p>
          )}
        </div>

        {/* Shelter capacity bars */}
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-6">
          <p className="font-display font-semibold text-[15px] mb-4">
            Shelter capacity
          </p>
          <div className="flex flex-col gap-4">
            {SHELTERS.map((s) => {
              const pct = Math.round((s.currentOccupancy / s.capacity) * 100);
              return (
                <div key={s.id}>
                  <div className="flex justify-between text-[13.5px] mb-1.5">
                    <span className="font-medium">{s.name}</span>
                    <span className="font-mono text-[12.5px] text-[var(--text-secondary)]">
                      {s.currentOccupancy}/{s.capacity}
                    </span>
                  </div>
                  <div className="w-full bg-[var(--bg-elevated)] rounded-full h-1.5">
                    <div
                      className="h-1.5 rounded-full"
                      style={{
                        width: `${pct}%`,
                        background:
                          pct > 85
                            ? "var(--danger)"
                            : pct > 60
                            ? "var(--warning)"
                            : "var(--success)",
                      }}
                    ></div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Hazard table */}
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-6">
        <p className="font-display font-semibold text-[15px] mb-4">
          Active hazard reports
        </p>

        {hazards.length === 0 ? (
          <p className="text-[var(--text-muted)] text-[13.5px]">
            No hazards reported yet. Go to &quot;Report &amp; respond&quot; to submit one.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[var(--text-secondary)] border-b border-[var(--border)]">
                  <th className="pb-2.5 pr-4 font-medium">Type</th>
                  <th className="pb-2.5 pr-4 font-medium">Severity</th>
                  <th className="pb-2.5 pr-4 font-medium">Status</th>
                  <th className="pb-2.5 font-medium">Description</th>
                </tr>
              </thead>
              <tbody>
                {hazards.map((h) => (
                  <tr key={h.id} className="border-b border-[var(--border)]/60">
                    <td className="py-2.5 pr-4">
                      <span className="flex items-center gap-2">
                        <span
                          className="w-2 h-2 rounded-full inline-block"
                          style={{
                            backgroundColor: HAZARD_COLORS[h.type] || "#5B6675",
                          }}
                        ></span>
                        {h.type.replace("_", " ")}
                      </span>
                    </td>
                    <td className="py-2.5 pr-4 capitalize">{h.severity}</td>
                    <td className="py-2.5 pr-4">
                      {h.verified ? (
                        <span className="text-[var(--success-text)]">✅ Verified</span>
                      ) : (
                        <span className="text-[var(--warning-text)]">⚠️ Unverified</span>
                      )}
                    </td>
                    <td className="py-2.5 text-[var(--text-secondary)]">{h.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  sublabel,
  accent,
  valueColor,
}: {
  label: string;
  value: string;
  sublabel: string;
  accent: string;
  valueColor: string;
}) {
  return (
    <div
      className="bg-[var(--surface)] border border-[var(--border)] rounded-[10px] p-5"
      style={{ borderLeft: `2px solid ${accent}` }}
    >
      <p className="text-[12.5px] text-[var(--text-secondary)] mb-2.5">{label}</p>
      <p className="font-mono text-[28px] font-medium mb-1.5" style={{ color: valueColor }}>
        {value}
      </p>
      <p className="font-mono text-xs text-[var(--text-muted)]">{sublabel}</p>
    </div>
  );
}

function BrandMark() {
  return (
    <div className="w-[30px] h-[30px] rounded-[7px] bg-[var(--accent-dim)] border border-[var(--border-strong)] flex items-center justify-center flex-shrink-0">
      <svg viewBox="0 0 24 24" fill="none" stroke="#2DD4BF" strokeWidth={1.8} className="w-4 h-4">
        <path d="M12 2 4 6v6c0 5 3.6 8.6 8 10 4.4-1.4 8-5 8-10V6z" />
        <path d="M9 12l2 2 4-4" />
      </svg>
    </div>
  );
}

function SidebarButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: JSX.Element;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-[11px] px-3 py-2.5 rounded-lg text-sm font-medium transition text-left border-l-2 ${
        active
          ? "bg-[var(--accent-dim)] text-[var(--accent-text)] border-l-[var(--accent)]"
          : "text-[var(--text-secondary)] border-l-transparent hover:bg-[var(--surface)]"
      }`}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-[17px] h-[17px] flex-shrink-0">
        {icon}
      </svg>
      {label}
    </button>
  );
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <span
        className="w-[9px] h-[9px] rounded-full inline-block flex-shrink-0"
        style={{ backgroundColor: color }}
      ></span>
      <span className="text-[var(--text-secondary)]">{label}</span>
    </div>
  );
}

function FeatureChip({ label, color }: { label: string; color: string }) {
  return (
    <span className="flex items-center gap-2 font-mono text-[11.5px] px-[13px] py-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[var(--text-secondary)]">
      <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: color }} />
      {label}
    </span>
  );
}