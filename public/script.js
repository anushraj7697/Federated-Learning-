/**
 * Shared client-side utilities for FL-AHPS
 */

// API base URL (same origin)
const API_BASE = "";

function api(path, options = {}) {
  return fetch(API_BASE + path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
}

