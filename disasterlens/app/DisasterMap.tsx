"use client";

import { MapContainer, TileLayer, Marker, Popup, Polyline } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import L from "leaflet";

// Fix for default marker icons not showing in Next.js
if (typeof window !== "undefined") {
  delete (L.Icon.Default.prototype as any)._getIconUrl;
  L.Icon.Default.mergeOptions({
    iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
    iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
    shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  });
}

export type Hazard = {
  id: number;
  lat: number;
  lng: number;
  type: string;
  severity: string;
  description: string;
  verified: boolean;
  reportCount: number;
};

export type Shelter = {
  id: number;
  name: string;
  lat: number;
  lng: number;
  capacity: number;
  currentOccupancy: number;
  hasFood: boolean;
  hasMedical: boolean;
  petFriendly: boolean;
};

export type Volunteer = {
  id: number;
  name: string;
  skill: string;
  contact: string;
  neighborhood: string;
  lat: number;
  lng: number;
};

// Approximate coordinates for real Tampa-area neighborhoods
export const TAMPA_NEIGHBORHOODS: Record<string, { lat: number; lng: number }> = {
  "Downtown Tampa": { lat: 27.9478, lng: -82.4584 },
  "Ybor City": { lat: 27.9581, lng: -82.4359 },
  "West Tampa": { lat: 27.9506, lng: -82.485 },
  "Tampa Heights": { lat: 27.9648, lng: -82.458 },
  "Seminole Heights": { lat: 27.9825, lng: -82.4573 },
  "South Tampa": { lat: 27.9086, lng: -82.4859 },
  "Brandon": { lat: 27.9378, lng: -82.2859 },
  "Carrollwood": { lat: 28.0648, lng: -82.4907 },
};

export const SHELTERS: Shelter[] = [
  {
    id: 1,
    name: "Tampa Heights Community Center",
    lat: 27.965,
    lng: -82.458,
    capacity: 200,
    currentOccupancy: 85,
    hasFood: true,
    hasMedical: true,
    petFriendly: true,
  },
  {
    id: 2,
    name: "West Tampa High School",
    lat: 27.945,
    lng: -82.485,
    capacity: 350,
    currentOccupancy: 310,
    hasFood: true,
    hasMedical: false,
    petFriendly: false,
  },
  {
    id: 3,
    name: "Ybor City Recreation Hall",
    lat: 27.958,
    lng: -82.435,
    capacity: 150,
    currentOccupancy: 40,
    hasFood: true,
    hasMedical: true,
    petFriendly: true,
  },
];

// Which volunteer skills are useful for each hazard type
const SKILL_MATCH: Record<string, string[]> = {
  flood: ["boat_rescue", "medical", "supplies"],
  fire: ["firefighting", "medical", "evacuation_support"],
  downed_tree: ["chainsaw", "electrician"],
  damaged_building: ["construction", "medical", "search_and_rescue"],
  blocked_road: ["heavy_equipment", "traffic_support"],
};

export function findMatchingVolunteers(hazardType: string, volunteers: Volunteer[]) {
  const neededSkills = SKILL_MATCH[hazardType] || [];
  return volunteers.filter((v) => neededSkills.includes(v.skill));
}

// Calculates straight-line distance between two points (in miles)
export function getDistance(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 3959; // Earth radius in miles
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export function findNearestShelter(lat: number, lng: number) {
  let nearest = SHELTERS[0];
  let minDist = getDistance(lat, lng, nearest.lat, nearest.lng);

  for (const shelter of SHELTERS) {
    const dist = getDistance(lat, lng, shelter.lat, shelter.lng);
    if (dist < minDist) {
      minDist = dist;
      nearest = shelter;
    }
  }

  return { shelter: nearest, distance: minDist };
}

// Checks nearby existing hazards to see if this is a duplicate/confirming report
export function checkVerification(
  newLat: number,
  newLng: number,
  newType: string,
  existingHazards: Hazard[]
) {
  const NEARBY_MILES = 1.5; // reports within this distance count as "same area"

  const matchingReports = existingHazards.filter((h) => {
    const dist = getDistance(newLat, newLng, h.lat, h.lng);
    return h.type === newType && dist <= NEARBY_MILES;
  });

  const reportCount = matchingReports.length + 1; // +1 for this new report
  const verified = reportCount >= 2;

  return { verified, reportCount };
}

// Checks if a blocked road hazard lies near the straight line between two points
export function checkRouteForBlockedRoads(
  startLat: number,
  startLng: number,
  endLat: number,
  endLng: number,
  hazards: Hazard[]
) {
  const BUFFER_MILES = 1; // how close a hazard needs to be to the route to count as "on the way"

  const blockedRoadHazards = hazards.filter((h) => h.type === "blocked_road");

  const nearbyBlockages = blockedRoadHazards.filter((h) => {
    // Check distance from hazard to both the start and end point as a simple approximation
    const distFromStart = getDistance(startLat, startLng, h.lat, h.lng);
    const distFromEnd = getDistance(endLat, endLng, h.lat, h.lng);
    const totalRouteDist = getDistance(startLat, startLng, endLat, endLng);

    // If hazard is roughly "between" start and end (not way off to the side), flag it
    return distFromStart + distFromEnd <= totalRouteDist + BUFFER_MILES;
  });

  return {
    hasBlockages: nearbyBlockages.length > 0,
    blockages: nearbyBlockages,
  };
}

// ---- Marker styling: matches the semantic palette used across the app ----

const MARKER_COLORS: Record<string, string> = {
  flood: "#7C93FF",
  fire: "#F0555A",
  downed_tree: "#34D399",
  damaged_building: "#F0A63A",
  blocked_road: "#E8B93F",
  none: "#5B6675",
  shelter: "#8B5CF6",
  volunteer: "#5EEAD4",
};

function pinDivIcon(color: string) {
  const html = `<svg width="26" height="34" viewBox="0 0 26 34" xmlns="http://www.w3.org/2000/svg">
    <path d="M13 0C5.8 0 0 5.8 0 13c0 9.5 13 21 13 21s13-11.5 13-21C26 5.8 20.2 0 13 0z" fill="${color}" stroke="#0A0E14" stroke-width="1"/>
    <circle cx="13" cy="13" r="5" fill="#0A0E14" fill-opacity="0.18"/>
  </svg>`;

  return L.divIcon({
    className: "", // prevents Leaflet's default white square background
    html,
    iconSize: [26, 34],
    iconAnchor: [13, 34],
    popupAnchor: [0, -30],
  });
}

function getColorIcon(type: string) {
  return pinDivIcon(MARKER_COLORS[type] || MARKER_COLORS.none);
}

export default function DisasterMap({
  hazards,
  volunteers = [],
  route = null,
}: {
  hazards: Hazard[];
  volunteers?: Volunteer[];
  route?: { start: [number, number]; end: [number, number]; blocked: boolean } | null;
}) {
  const center: [number, number] = [27.9506, -82.4572];

  const shelterIcon = pinDivIcon(MARKER_COLORS.shelter);
  const volunteerIcon = pinDivIcon(MARKER_COLORS.volunteer);

  return (
    <div className="p-[10px] bg-[var(--bg-elevated)]">
      <MapContainer
        center={center}
        zoom={11}
        style={{ height: "440px", width: "100%", borderRadius: "8px" }}
      >
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; OpenStreetMap contributors'
        />

        {/* Hazard pins */}
        {hazards.map((hazard) => (
          <Marker
            key={hazard.id}
            position={[hazard.lat, hazard.lng]}
            icon={getColorIcon(hazard.type)}
          >
            <Popup>
              <strong>{hazard.type.replace("_", " ").toUpperCase()}</strong>
              <br />
              Severity: {hazard.severity}
              <br />
              {hazard.description}
              <br />
              <br />
              {hazard.verified ? (
                <span style={{ color: "#6EE7B7", fontWeight: "bold" }}>
                  ✅ Verified ({hazard.reportCount} reports)
                </span>
              ) : (
                <span style={{ color: "#F3BE72", fontWeight: "bold" }}>
                  ⚠️ Unverified (1 report)
                </span>
              )}
            </Popup>
          </Marker>
        ))}

        {/* Shelter pins */}
        {SHELTERS.map((shelter) => (
          <Marker
            key={`shelter-${shelter.id}`}
            position={[shelter.lat, shelter.lng]}
            icon={shelterIcon}
          >
            <Popup>
              <strong>{shelter.name}</strong>
              <br />
              Occupancy: {shelter.currentOccupancy}/{shelter.capacity}
              <br />
              {shelter.hasFood ? "✅ Food" : "❌ No food"}
              <br />
              {shelter.hasMedical ? "✅ Medical staff" : "❌ No medical staff"}
              <br />
              {shelter.petFriendly ? "✅ Pet-friendly" : "❌ Not pet-friendly"}
            </Popup>
          </Marker>
        ))}

        {/* Route line */}
        {route && (
          <Polyline
            positions={[route.start, route.end]}
            pathOptions={{
              color: route.blocked ? "#F0555A" : "#5EEAD4",
              weight: 4,
              dashArray: "8, 6",
            }}
          />
        )}

        {/* Volunteer pins */}
        {volunteers.map((volunteer) => (
          <Marker
            key={`volunteer-${volunteer.id}`}
            position={[volunteer.lat, volunteer.lng]}
            icon={volunteerIcon}
          >
            <Popup>
              <strong>{volunteer.name}</strong>
              <br />
              Skill: {volunteer.skill.replace("_", " ")}
              <br />
              Neighborhood: {volunteer.neighborhood}
              <br />
              Contact: {volunteer.contact}
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}