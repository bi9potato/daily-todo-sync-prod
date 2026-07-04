import { recordClientLog } from "./client-logs";

// Android's built-in Geocoder delegates to whatever backend the OEM wired
// in - on most Chinese ROMs (Xiaomi, Huawei, Oppo, Vivo) that is the vendor's
// own AMap/Baidu-backed service, which resolves addresses in GCJ-02, the
// legally-mandated offset coordinate system Chinese map providers must use.
// Every fix this app ever has is raw WGS84 GPS, so on those devices the
// on-device geocoder silently resolves the wrong building or street - the
// same class of misalignment the base map tiles were switched to a raw OSM
// raster source to avoid (see MAP_STYLE in RouteMap.tsx). Nominatim is
// OpenStreetMap's own reverse geocoder: natively WGS84, served from the same
// osm.org infrastructure the base map already depends on and reachable from
// mainland China, so it sidesteps the coordinate mismatch instead of trusting
// an opaque OEM backend.
const NOMINATIM_REVERSE_URL = "https://nominatim.openstreetmap.org/reverse";
// Nominatim's usage policy caps free public use at roughly 1 request/sec and
// asks callers to identify themselves via User-Agent. Visits are reverse
// geocoded a handful of times a day at most, well under that ceiling.
const USER_AGENT = "DailyTodoSync-Mobile/1.0";

// A resolved label is "no real name" when every character is a digit,
// separator, or a lone unit/floor word - e.g. a bare house number like "1500"
// - since that reads as meaningless noise for an auto-detected visit.
function isNumericOnlyLabel(value: string) {
  return /^[\d\s.,\-/#号栋幢楼层]+$/.test(value.trim());
}

type NominatimAddress = {
  amenity?: string;
  shop?: string;
  office?: string;
  tourism?: string;
  leisure?: string;
  road?: string;
  house_number?: string;
  suburb?: string;
  neighbourhood?: string;
  city_district?: string;
  city?: string;
  town?: string;
  village?: string;
};

type NominatimReverseResponse = {
  name?: string;
  display_name?: string;
  address?: NominatimAddress;
};

function labelFromResponse(data: NominatimReverseResponse): string {
  const poiName =
    data.name ||
    data.address?.amenity ||
    data.address?.shop ||
    data.address?.office ||
    data.address?.tourism ||
    data.address?.leisure;
  if (poiName && !isNumericOnlyLabel(poiName)) {
    return poiName;
  }
  const streetLabel = [data.address?.road, data.address?.house_number]
    .filter((value): value is string => Boolean(value && value.trim()))
    .join(" ");
  const districtLabel = [
    data.address?.suburb || data.address?.neighbourhood,
    data.address?.city_district ||
      data.address?.city ||
      data.address?.town ||
      data.address?.village,
  ]
    .filter((value): value is string => Boolean(value && value.trim()))
    .join(" · ");
  if (districtLabel && streetLabel) {
    return `${districtLabel} · ${streetLabel}`;
  }
  if (districtLabel || streetLabel) {
    return districtLabel || streetLabel;
  }
  if (data.display_name && !isNumericOnlyLabel(data.display_name)) {
    return data.display_name;
  }
  return "";
}

// Resolves a visit's coordinate to a human-readable place name over the
// network instead of the platform's on-device geocoder. Returns null (rather
// than throwing) on any network or parsing failure so callers can fall back
// to a generic "停留地点" label.
export async function reverseGeocode(
  latitude: number,
  longitude: number,
): Promise<string | null> {
  const url =
    `${NOMINATIM_REVERSE_URL}?format=jsonv2&lat=${latitude}&lon=${longitude}` +
    `&zoom=18&addressdetails=1&accept-language=zh-CN`;
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        "Accept-Language": "zh-CN",
      },
    });
    if (!response.ok) {
      return null;
    }
    const data = (await response.json()) as NominatimReverseResponse;
    const label = labelFromResponse(data);
    return label || null;
  } catch (error) {
    recordClientLog("warn", "Nominatim reverse geocode failed", {
      source: "mobility",
      context: {
        message: error instanceof Error ? error.message : String(error),
      },
    });
    return null;
  }
}
