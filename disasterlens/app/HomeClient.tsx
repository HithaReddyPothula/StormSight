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

const HAZARD_COLORS: Record<string, string> = {
  flood: "#3388ff",
  fire: "#ff3333",
  downed_tree: "#33cc33",
  damaged_building: "#ff9900",
  blocked_road: "#ffcc00",
  none: "#888888",
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

  if (showIntro) {
    return (
      <main className="min-h-screen bg-slate-950 text-white flex flex-col relative overflow-hidden">
        {/* Background glow effect */}
        <div className="absolute inset-0 bg-gradient-to-br from-orange-900/20 via-slate-950 to-blue-900/20"></div>
        <div className="absolute top-1/3 right-0 w-96 h-96 bg-orange-500/10 rounded-full blur-3xl"></div>
        <div className="absolute bottom-0 left-1/4 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl"></div>

        {/* Top nav */}
        <nav className="relative z-10 flex items-center justify-between px-8 py-5">
          <div className="flex items-center gap-2">
            <span className="text-2xl">🛰️</span>
            <span className="font-bold text-lg">DisasterLens</span>
            <span className="text-xs bg-slate-800 text-slate-400 px-2 py-0.5 rounded-full ml-1">
              v1.0
            </span>
          </div>
          <button
            onClick={() => setShowIntro(false)}
            className="bg-orange-500 hover:bg-orange-600 text-white font-medium px-5 py-2 rounded-lg text-sm transition"
          >
            Dashboard →
          </button>
        </nav>

        {/* Hero content */}
        <div className="relative z-10 flex-1 flex flex-col justify-center px-8 max-w-3xl">
          <div className="inline-block mb-4">
            <span className="text-xs font-medium bg-orange-500/10 text-orange-300 border border-orange-500/30 px-3 py-1 rounded-full">
              ● AI DISASTER INTELLIGENCE · TAMPA BAY
            </span>
          </div>

          <h1 className="text-6xl font-bold mb-6 leading-tight">
            Disaster
            <span className="text-orange-400">Lens</span>
          </h1>

          <p className="text-slate-300 text-lg mb-2 max-w-xl">
            When disaster strikes, every second matters.
          </p>
          <p className="text-slate-400 mb-10 max-w-xl">
            DisasterLens turns community-submitted photos and voice reports
            into real-time emergency intelligence — helping responders
            identify hazards, locate shelters, and save lives{" "}
            <strong className="text-white">faster.</strong>
          </p>

          <div className="flex gap-4 mb-10">
            <button
              onClick={() => setShowIntro(false)}
              className="bg-orange-500 hover:bg-orange-600 text-white font-semibold px-8 py-3 rounded-lg text-lg transition"
            >
              Launch Dashboard →
            </button>
          </div>

          {/* Feature badges */}
          <div className="flex flex-wrap gap-2">
            <FeatureBadge icon="📸" label="Hazard Analyzer" color="orange" />
            <FeatureBadge icon="✅" label="Verification Agent" color="green" />
            <FeatureBadge icon="🤝" label="Resource Coordinator" color="blue" />
            <FeatureBadge icon="🧭" label="Route Advisor" color="purple" />
          </div>
        </div>

        {/* Bottom ticker */}
        <div className="relative z-10 bg-slate-900/80 border-t border-slate-800 px-6 py-2 text-xs text-slate-400 flex items-center gap-3 overflow-hidden">
          <span className="bg-red-600 text-white px-2 py-0.5 rounded font-semibold flex-shrink-0">
            SIM
          </span>
          <span className="whitespace-nowrap">
            ⚠ Simulation Active — Hurricane Demo Scenario · Tampa Bay Region ·
            Built for BAM Summer Mentorship Program Hackathon 2026
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

  return (
    <main className="min-h-screen bg-slate-950 text-white flex">
      {/* Sidebar */}
      <aside className="w-56 bg-slate-900 border-r border-slate-800 flex flex-col p-4 flex-shrink-0">
        <button
          onClick={() => setShowIntro(true)}
          className="flex items-center gap-2 mb-8 px-2 text-left hover:opacity-80 transition"
        >
          <span className="text-2xl">🛰️</span>
          <div>
            <p className="font-bold text-orange-400 leading-tight">
              DisasterLens
            </p>
            <p className="text-xs text-slate-500">Tampa Bay · v1.0</p>
          </div>
        </button>

        <nav className="flex flex-col gap-1">
          <SidebarButton
            active={currentView === "dashboard"}
            onClick={() => setCurrentView("dashboard")}
            icon="📊"
            label="Dashboard"
          />
          <SidebarButton
            active={currentView === "report"}
            onClick={() => setCurrentView("report")}
            icon="📸"
            label="Report & Respond"
          />
          <SidebarButton
            active={currentView === "volunteers"}
            onClick={() => setCurrentView("volunteers")}
            icon="🤝"
            label="Volunteers"
          />
          <SidebarButton
            active={currentView === "routes"}
            onClick={() => setCurrentView("routes")}
            icon="🧭"
            label="Routes"
          />
        </nav>

        <div className="mt-auto pt-4 border-t border-slate-800">
          <button
            onClick={() => setShowIntro(true)}
            className="text-xs text-slate-500 hover:text-slate-300 px-2 transition"
          >
            ← Back to Landing
          </button>
        </div>
      </aside>

      {/* Main content area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Simulation banner */}
        <div className="bg-orange-600/20 border-b border-orange-500/40 px-6 py-2 text-sm text-orange-300 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-orange-400 animate-pulse"></span>
          SIMULATION MODE — Hurricane Demo Scenario, Tampa Bay Region
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
                <h1 className="text-3xl font-bold text-orange-400 mb-2 text-center">
                  Report & Respond
                </h1>
                <p className="text-slate-300 mb-8 text-center max-w-md mx-auto">
                  Upload a photo or record a voice note from a
                  hurricane-affected area. Our AI will identify the hazard
                  and add it to the live map.
                </p>

                <div className="flex flex-col lg:flex-row gap-8">
                  {/* Upload panel */}
                  <div className="w-full lg:w-1/3">
                    <div className="border-2 border-dashed border-slate-500 rounded-xl p-10 text-center">
                      <p className="text-slate-400 mb-4">
                        Choose a photo to analyze
                      </p>

                      <label className="inline-block bg-orange-500 hover:bg-orange-600 text-white font-medium px-5 py-2 rounded-lg cursor-pointer transition">
                        Choose File
                        <input
                          type="file"
                          accept="image/*"
                          onChange={handleFileSelect}
                          className="hidden"
                        />
                      </label>

                      <p className="mt-3 text-sm text-slate-400">
                        {fileName ? fileName : "No file chosen"}
                      </p>

                      {image && (
                        <img
                          src={image}
                          alt="Uploaded preview"
                          className="mt-6 rounded-lg max-h-64 mx-auto"
                        />
                      )}

                      {image && (
                        <>
                          <textarea
                            value={notes}
                            onChange={(e) => setNotes(e.target.value)}
                            placeholder="Add details: exact location, what's happening, who needs help..."
                            className="mt-4 w-full bg-slate-800 border border-slate-600 rounded-lg p-3 text-sm text-white placeholder-slate-500 resize-none"
                            rows={3}
                          />

                          <button
                            onClick={isRecording ? stopRecording : startRecording}
                            disabled={transcribing}
                            className={`mt-2 w-full px-4 py-2 rounded-lg text-sm font-medium transition ${
                              isRecording
                                ? "bg-red-600 hover:bg-red-700 animate-pulse"
                                : "bg-slate-700 hover:bg-slate-600"
                            }`}
                          >
                            {transcribing
                              ? "Transcribing..."
                              : isRecording
                              ? "⏹ Stop Recording"
                              : "🎤 Record Voice Note"}
                          </button>
                        </>
                      )}

                      {image && (
                        <button
                          onClick={handleSubmit}
                          disabled={loading}
                          className="mt-6 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-600 text-white font-medium px-6 py-2 rounded-lg transition"
                        >
                          {loading ? "Analyzing..." : "Submit for Analysis"}
                        </button>
                      )}

                      {result && (
                        <pre className="mt-6 text-left text-sm bg-slate-800 p-4 rounded-lg whitespace-pre-wrap">
                          {result}
                        </pre>
                      )}

                      {verificationInfo && (
                        <div
                          className={`mt-4 text-left text-sm p-4 rounded-lg border ${
                            verificationInfo.verified
                              ? "bg-green-900/40 border-green-500"
                              : "bg-yellow-900/40 border-yellow-500"
                          }`}
                        >
                          {verificationInfo.verified
                            ? `✅ Verified — confirmed by ${verificationInfo.reportCount} independent reports in this area`
                            : "⚠️ Unverified — only 1 report so far. Will auto-upgrade if others report nearby."}
                        </div>
                      )}

                      {nearestShelterInfo && (
                        <div className="mt-4 text-left text-sm bg-purple-900/40 border border-purple-500 p-4 rounded-lg">
                          🏠 {nearestShelterInfo}
                        </div>
                      )}

                      {estimatedCost && (
                        <div className="mt-4 text-left text-sm bg-slate-800 border border-slate-500 p-4 rounded-lg">
                          <p className="text-orange-300 font-semibold mb-1">
                            💰 Estimated Damage Cost:
                          </p>
                          <p className="text-slate-300">{estimatedCost}</p>
                          <p className="text-xs text-slate-500 mt-1">
                            Rough AI visual estimate — not a professional
                            appraisal
                          </p>
                        </div>
                      )}

                      {matchedVolunteers.length > 0 && (
                        <div className="mt-4 text-left text-sm bg-slate-800 border border-slate-500 p-4 rounded-lg">
                          <p className="font-semibold text-orange-300 mb-2">
                            🤝 Matched Volunteers:
                          </p>
                          {matchedVolunteers.map((v) => (
                            <div key={v.id} className="text-slate-300 mb-2">
                              <p className="font-medium text-white">
                                {v.name}
                              </p>
                              <p className="text-xs text-slate-400">
                                {v.skill.replace("_", " ")} ·{" "}
                                {v.neighborhood}
                              </p>
                              <p className="text-xs text-green-400">
                                📞 {v.contact}
                              </p>
                            </div>
                          ))}
                        </div>
                      )}

                      {result && matchedVolunteers.length === 0 && (
                        <div className="mt-4 text-left text-sm bg-slate-800 border border-slate-600 p-4 rounded-lg text-slate-400">
                          🤝 No matching volunteers signed up yet for this
                          hazard type.
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Map panel */}
                  <div className="w-full lg:w-2/3">
                    <DisasterMap
                      hazards={hazards}
                      volunteers={volunteers}
                      route={route}
                    />

                    {/* Legend */}
                    <div className="mt-4 flex flex-wrap gap-4 text-sm bg-slate-800 p-4 rounded-lg">
                      <LegendItem color="#3388ff" label="Flood" />
                      <LegendItem color="#ff3333" label="Fire" />
                      <LegendItem color="#33cc33" label="Downed Tree" />
                      <LegendItem color="#ff9900" label="Damaged Building" />
                      <LegendItem color="#ffcc00" label="Blocked Road" />
                      <LegendItem color="#9b59b6" label="Shelter" />
                      <LegendItem color="#333333" label="Volunteer" />
                    </div>
                  </div>
                </div>
              </>
            )}

            {currentView === "volunteers" && (
              <>
                <h1 className="text-3xl font-bold text-orange-400 mb-2 text-center">
                  Volunteers
                </h1>
                <p className="text-slate-300 mb-8 text-center max-w-md mx-auto">
                  Sign up to help, and see who's already registered to
                  respond in each neighborhood.
                </p>

                <div className="flex flex-col lg:flex-row gap-8">
                  {/* Sign-up panel */}
                  <div className="w-full lg:w-1/3">
                    <div className="bg-slate-800 rounded-xl p-6">
                      <p className="font-semibold text-orange-300 mb-3">
                        Want to help? Sign up as a volunteer:
                      </p>

                      <input
                        type="text"
                        value={volunteerName}
                        onChange={(e) => setVolunteerName(e.target.value)}
                        placeholder="Your name"
                        className="w-full bg-slate-900 border border-slate-600 rounded-lg p-2 text-sm text-white placeholder-slate-500 mb-3"
                      />

                      <input
                        type="text"
                        value={volunteerContact}
                        onChange={(e) => setVolunteerContact(e.target.value)}
                        placeholder="Phone or email"
                        className="w-full bg-slate-900 border border-slate-600 rounded-lg p-2 text-sm text-white placeholder-slate-500 mb-3"
                      />

                      <select
                        value={volunteerNeighborhood}
                        onChange={(e) =>
                          setVolunteerNeighborhood(e.target.value)
                        }
                        className="w-full bg-slate-900 border border-slate-600 rounded-lg p-2 text-sm text-white mb-3"
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
                        className="w-full bg-slate-900 border border-slate-600 rounded-lg p-2 text-sm text-white mb-3"
                      >
                        {SKILL_OPTIONS.map((s) => (
                          <option key={s.value} value={s.value}>
                            {s.label}
                          </option>
                        ))}
                      </select>

                      <button
                        onClick={handleVolunteerSignup}
                        className="w-full bg-green-600 hover:bg-green-700 text-white font-medium px-4 py-2 rounded-lg transition"
                      >
                        Sign Up
                      </button>
                    </div>
                  </div>

                  {/* Registered volunteers list */}
                  <div className="w-full lg:w-2/3">
                    <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
                      <p className="font-semibold text-slate-200 mb-4">
                        Registered Volunteers ({volunteers.length})
                      </p>

                      {volunteers.length === 0 ? (
                        <p className="text-slate-500 text-sm">
                          No volunteers signed up yet.
                        </p>
                      ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          {volunteers.map((v) => (
                            <div
                              key={v.id}
                              className="bg-slate-800 border border-slate-700 rounded-lg p-4"
                            >
                              <p className="font-medium text-white">
                                {v.name}
                              </p>
                              <p className="text-xs text-slate-400 mt-1">
                                {v.skill.replace("_", " ")} · {v.neighborhood}
                              </p>
                              <p className="text-xs text-green-400 mt-1">
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
                <h1 className="text-3xl font-bold text-orange-400 mb-2 text-center">
                  Routes
                </h1>
                <p className="text-slate-300 mb-8 text-center max-w-md mx-auto">
                  Get directions to the nearest shelter, with warnings if a
                  reported hazard is blocking the way.
                </p>

                <div className="flex flex-col lg:flex-row gap-8">
                  {/* Directions panel */}
                  <div className="w-full lg:w-1/3">
                    <div className="bg-slate-800 rounded-xl p-6">
                      <p className="font-semibold text-orange-300 mb-3">
                        🧭 Get Directions to a Shelter
                      </p>

                      <label className="text-xs text-slate-400 mb-1 block">
                        Your location
                      </label>
                      <select
                        value={myLocation}
                        onChange={(e) => setMyLocation(e.target.value)}
                        className="w-full bg-slate-900 border border-slate-600 rounded-lg p-2 text-sm text-white mb-3"
                      >
                        {NEIGHBORHOOD_OPTIONS.map((n) => (
                          <option key={n} value={n}>
                            {n}
                          </option>
                        ))}
                      </select>

                      <label className="text-xs text-slate-400 mb-1 block">
                        Destination shelter
                      </label>
                      <select
                        value={destinationShelterId}
                        onChange={(e) =>
                          setDestinationShelterId(Number(e.target.value))
                        }
                        className="w-full bg-slate-900 border border-slate-600 rounded-lg p-2 text-sm text-white mb-3"
                      >
                        {SHELTERS.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </select>

                      <button
                        onClick={handleGetDirections}
                        className="w-full bg-orange-500 hover:bg-orange-600 text-white font-medium px-4 py-2 rounded-lg transition"
                      >
                        Get Directions
                      </button>

                      {route && (
                        <div
                          className={`mt-4 text-sm p-3 rounded-lg border ${
                            route.blocked
                              ? "bg-red-900/40 border-red-500"
                              : "bg-green-900/40 border-green-500"
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
                    <DisasterMap
                      hazards={hazards}
                      volunteers={volunteers}
                      route={route}
                    />

                    <div className="mt-4 flex flex-wrap gap-4 text-sm bg-slate-800 p-4 rounded-lg">
                      <LegendItem color="#3388ff" label="Flood" />
                      <LegendItem color="#ff3333" label="Fire" />
                      <LegendItem color="#33cc33" label="Downed Tree" />
                      <LegendItem color="#ff9900" label="Damaged Building" />
                      <LegendItem color="#ffcc00" label="Blocked Road" />
                      <LegendItem color="#9b59b6" label="Shelter" />
                    </div>
                  </div>
                </div>
              </>
            )}
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
      <h1 className="text-3xl font-bold text-orange-400 mb-1">
        Command Dashboard
      </h1>
      <p className="text-slate-400 mb-6 text-sm">
        Tampa Bay Region · Emergency Response Overview
      </p>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard
          label="Active Hazards"
          value={hazards.length.toString()}
          sublabel={`${criticalCount} high severity`}
          color="orange"
        />
        <StatCard
          label="Verified Reports"
          value={verifiedCount.toString()}
          sublabel={`of ${hazards.length} total reports`}
          color="green"
        />
        <StatCard
          label="Shelter Capacity"
          value={`${capacityPercent}%`}
          sublabel={`${totalOccupied} / ${totalCapacity} occupied`}
          color="purple"
        />
        <StatCard
          label="Volunteers Ready"
          value={volunteers.length.toString()}
          sublabel="registered responders"
          color="blue"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        {/* Hazard reports over time chart */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
          <p className="font-semibold text-slate-200 mb-4">
            Reports Over Time
          </p>
          {chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="name" stroke="#94a3b8" fontSize={12} />
                <YAxis stroke="#94a3b8" fontSize={12} allowDecimals={false} />
                <Tooltip
                  contentStyle={{
                    background: "#1e293b",
                    border: "1px solid #334155",
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="reports"
                  stroke="#f97316"
                  strokeWidth={2}
                />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-slate-500 text-sm">
              No reports yet — submit a photo in "Report & Respond" to see
              data here.
            </p>
          )}
        </div>

        {/* Shelter capacity bars */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
          <p className="font-semibold text-slate-200 mb-4">
            Shelter Capacity
          </p>
          <div className="flex flex-col gap-4">
            {SHELTERS.map((s) => {
              const pct = Math.round((s.currentOccupancy / s.capacity) * 100);
              return (
                <div key={s.id}>
                  <div className="flex justify-between text-xs text-slate-400 mb-1">
                    <span>{s.name}</span>
                    <span>
                      {s.currentOccupancy}/{s.capacity}
                    </span>
                  </div>
                  <div className="w-full bg-slate-800 rounded-full h-2">
                    <div
                      className={`h-2 rounded-full ${
                        pct > 85
                          ? "bg-red-500"
                          : pct > 60
                          ? "bg-yellow-500"
                          : "bg-green-500"
                      }`}
                      style={{ width: `${pct}%` }}
                    ></div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Hazard table */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
        <p className="font-semibold text-slate-200 mb-4">
          Active Hazard Reports
        </p>

        {hazards.length === 0 ? (
          <p className="text-slate-500 text-sm">
            No hazards reported yet. Go to "Report & Respond" to submit one.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-400 border-b border-slate-800">
                  <th className="pb-2 pr-4">Type</th>
                  <th className="pb-2 pr-4">Severity</th>
                  <th className="pb-2 pr-4">Status</th>
                  <th className="pb-2">Description</th>
                </tr>
              </thead>
              <tbody>
                {hazards.map((h) => (
                  <tr key={h.id} className="border-b border-slate-800/50">
                    <td className="py-2 pr-4">
                      <span className="flex items-center gap-2">
                        <span
                          className="w-2 h-2 rounded-full inline-block"
                          style={{
                            backgroundColor: HAZARD_COLORS[h.type] || "#888",
                          }}
                        ></span>
                        {h.type.replace("_", " ")}
                      </span>
                    </td>
                    <td className="py-2 pr-4 capitalize">{h.severity}</td>
                    <td className="py-2 pr-4">
                      {h.verified ? (
                        <span className="text-green-400">✅ Verified</span>
                      ) : (
                        <span className="text-yellow-400">⚠️ Unverified</span>
                      )}
                    </td>
                    <td className="py-2 text-slate-400">{h.description}</td>
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
  color,
}: {
  label: string;
  value: string;
  sublabel: string;
  color: "orange" | "green" | "purple" | "blue";
}) {
  const colorMap = {
    orange: "text-orange-400",
    green: "text-green-400",
    purple: "text-purple-400",
    blue: "text-blue-400",
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
      <p className="text-xs text-slate-500 mb-1">{label}</p>
      <p className={`text-3xl font-bold ${colorMap[color]}`}>{value}</p>
      <p className="text-xs text-slate-500 mt-1">{sublabel}</p>
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
  icon: string;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition text-left ${
        active
          ? "bg-orange-500/20 text-orange-300 border border-orange-500/40"
          : "text-slate-400 hover:bg-slate-800 hover:text-white"
      }`}
    >
      <span>{icon}</span>
      {label}
    </button>
  );
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <span
        className="w-3 h-3 rounded-full inline-block"
        style={{ backgroundColor: color }}
      ></span>
      <span className="text-slate-300">{label}</span>
    </div>
  );
}

function FeatureBadge({
  icon,
  label,
  color,
}: {
  icon: string;
  label: string;
  color: "orange" | "green" | "blue" | "purple";
}) {
  const colorMap = {
    orange: "bg-orange-500/10 text-orange-300 border-orange-500/30",
    green: "bg-green-500/10 text-green-300 border-green-500/30",
    blue: "bg-blue-500/10 text-blue-300 border-blue-500/30",
    purple: "bg-purple-500/10 text-purple-300 border-purple-500/30",
  };

  return (
    <span
      className={`text-xs font-medium px-3 py-1.5 rounded-full border ${colorMap[color]}`}
    >
      {icon} {label}
    </span>
  );
}