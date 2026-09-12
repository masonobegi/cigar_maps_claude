const BASE = '/api';

function getToken() { return localStorage.getItem('cigarbuddy_token'); }
function authHeaders() {
  const t = getToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...authHeaders(), ...(options.headers || {}) },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

export const api = {
  // Auth
  login: (b) => request('/auth/login', { method: 'POST', body: JSON.stringify(b) }),
  register: (b) => request('/auth/register', { method: 'POST', body: JSON.stringify(b) }),
  me: () => request('/auth/me'),
  forgotPassword: (email) => request('/auth/forgot', { method: 'POST', body: JSON.stringify({ email }) }),
  resetPassword: (b) => request('/auth/reset', { method: 'POST', body: JSON.stringify(b) }),
  sendVerification: () => request('/auth/send-verification', { method: 'POST' }),
  verifyEmail: (b) => request('/auth/verify-email', { method: 'POST', body: JSON.stringify(b) }),

  // Billing (paid placement for claimed stores)
  getPlans: () => request('/billing/plans'),
  getStoreBilling: (id) => request(`/billing/stores/${id}`),
  startCheckout: (id, plan) => request(`/billing/stores/${id}/checkout`, { method: 'POST', body: JSON.stringify({ plan }) }),
  openBillingPortal: (id) => request(`/billing/stores/${id}/portal`, { method: 'POST' }),
  cancelPlan: (id) => request(`/billing/stores/${id}/cancel`, { method: 'POST' }),

  // Online menus (inventory read from the shop's own website)
  getStoreMenuStatus: (id) => request(`/stores/${id}/menu-status`),
  refreshStoreMenu: (id) => request(`/stores/${id}/menu/refresh`, { method: 'POST' }),
  setMenuOptOut: (id, opt_out) => request(`/stores/${id}/menu/opt-out`, { method: 'PUT', body: JSON.stringify({ opt_out }) }),
  adminGetCatalogPending: (p = {}) => request(`/admin/catalog-pending?${new URLSearchParams(p)}`),
  adminResolveCatalogPending: (id, b) => request(`/admin/catalog-pending/${id}/resolve`, { method: 'POST', body: JSON.stringify(b) }),
  adminRunMenuScan: (b = {}) => request('/admin/menu-scan', { method: 'POST', body: JSON.stringify(b) }),
  adminRunLinkCheck: (b = {}) => request('/admin/link-check', { method: 'POST', body: JSON.stringify(b) }),
  adminGetDeadLinks: (p = {}) => request(`/admin/dead-links?${new URLSearchParams(p)}`),
  updateProfile: (b) => request('/users/me/profile', { method: 'PUT', body: JSON.stringify(b) }),

  // Cigars
  searchCigars: (p) => request(`/cigars?${new URLSearchParams(p)}`),
  getCigar: (id) => request(`/cigars/${id}`),
  getCigarAvailability: (id, p = {}) => request(`/cigars/${id}/availability?${new URLSearchParams(p)}`),
  getCigarReviews: (id, p = {}) => request(`/cigars/${id}/reviews?${new URLSearchParams(p)}`),
  getPriceComparison: (id) => request(`/cigars/${id}/price-comparison`),
  postReview: (cigarId, b) => request(`/cigars/${cigarId}/reviews`, { method: 'POST', body: JSON.stringify(b) }),
  getBrands: () => request('/cigars/brands'),
  getFilters: () => request('/cigars/filters'),
  followCigar: (id) => request(`/cigars/${id}/follow`, { method: 'POST' }),
  getCigarFollowStatus: (id) => request(`/cigars/${id}/follow-status`),
  getFollowedCigars: () => request('/cigars/followed'),

  // Stores
  // GET /stores answers with { stores, total, next_offset, ... } so a caller can
  // tell a short list from a complete one — the old bare array is exactly how
  // silent truncation went unnoticed. searchStores keeps handing back the array
  // for the callers that only want cards; searchStorePage hands back the whole
  // answer, for the one that shows a count and a Show more button.
  searchStorePage: (p = {}) => request(`/stores?${new URLSearchParams(p)}`),
  searchStores: (p = {}) => request(`/stores?${new URLSearchParams(p)}`)
    .then(r => (Array.isArray(r) ? r : r.stores || [])),
  // The map's own endpoint. It returns pins and cluster bubbles counted over
  // every matching listing, not over a page of them, so the bubble labels and
  // the header count are the real numbers. See server/src/utils/storeMap.js.
  getStoreMap: (p = {}) => request(`/stores/map?${new URLSearchParams(p)}`),
  getStoreCities: () => request('/stores/cities'),
  getDirectoryStats: () => request('/stores/stats'),
  getStore: (id) => request(`/stores/${id}`),
  getStoreInventory: (id, p = {}) => request(`/stores/${id}/inventory?${new URLSearchParams(p)}`),
  getStoreInventoryBrands: (id) => request(`/stores/${id}/inventory/brands`),
  createStore: (b) => request('/stores', { method: 'POST', body: JSON.stringify(b) }),
  updateStore: (id, b) => request(`/stores/${id}`, { method: 'PUT', body: JSON.stringify(b) }),
  claimStore: (id, b) => request(`/stores/${id}/claim`, { method: 'POST', body: JSON.stringify(b || {}) }),
  verifyClaim: (id, code) => request(`/stores/${id}/claim/verify`, { method: 'POST', body: JSON.stringify({ code }) }),
  getClaimStatus: (id) => request(`/stores/${id}/claim-status`),
  reportStore: (id, b) => request(`/stores/${id}/report`, { method: 'POST', body: JSON.stringify(b) }),
  getManageInventory: (id, p = {}) => request(`/stores/${id}/manage-inventory?${new URLSearchParams(p)}`),
  addInventory: (sid, b) => request(`/stores/${sid}/inventory`, { method: 'POST', body: JSON.stringify(b) }),
  bulkAddInventory: (sid, items) => request(`/stores/${sid}/inventory/bulk`, { method: 'POST', body: JSON.stringify({ items }) }),
  updateInventory: (sid, iid, b) => request(`/stores/${sid}/inventory/${iid}`, { method: 'PUT', body: JSON.stringify(b) }),
  restockInventory: (sid, iid, qty) => request(`/stores/${sid}/inventory/${iid}/restock`, { method: 'PATCH', body: JSON.stringify({ quantity: qty }) }),
  deleteInventory: (sid, iid) => request(`/stores/${sid}/inventory/${iid}`, { method: 'DELETE' }),
  broadcastNotification: (sid, b) => request(`/stores/${sid}/broadcast`, { method: 'POST', body: JSON.stringify(b) }),
  getBroadcasts: (sid) => request(`/stores/${sid}/broadcasts`),
  getAnalytics: (sid) => request(`/stores/${sid}/analytics`),
  addDeal: (sid, b) => request(`/stores/${sid}/deals`, { method: 'POST', body: JSON.stringify(b) }),
  deleteDeal: (sid, did) => request(`/stores/${sid}/deals/${did}`, { method: 'DELETE' }),
  followStore: (id) => request(`/stores/${id}/follow`, { method: 'POST' }),
  updateFollowPrefs: (id, b) => request(`/stores/${id}/follow-prefs`, { method: 'PUT', body: JSON.stringify(b) }),
  rateStore: (id, b) => request(`/stores/${id}/rate`, { method: 'POST', body: JSON.stringify(b) }),
  submitVerificationRequest: (id, b) => request(`/stores/${id}/verification-request`, { method: 'POST', body: JSON.stringify(b) }),
  getVerificationStatus: (id) => request(`/stores/${id}/verification-status`),
  submitInventoryRequest: (sid, b) => request(`/stores/${sid}/inventory-requests`, { method: 'POST', body: JSON.stringify(b) }),
  getInventoryRequests: (sid) => request(`/stores/${sid}/inventory-requests`),
  acknowledgeRequest: (sid, rid) => request(`/stores/${sid}/inventory-requests/${rid}/acknowledge`, { method: 'PATCH' }),
  getTopRequests: (sid) => request(`/stores/${sid}/top-requests`),

  // Users
  getHumidor: (p = {}) => request(`/users/me/humidor?${new URLSearchParams(p)}`),
  addToHumidor: (b) => request('/users/me/humidor', { method: 'POST', body: JSON.stringify(b) }),
  updateHumidorItem: (id, b) => request(`/users/me/humidor/${id}`, { method: 'PUT', body: JSON.stringify(b) }),
  deleteHumidorItem: (id) => request(`/users/me/humidor/${id}`, { method: 'DELETE' }),
  syncHumidorSheet: () => request('/users/me/humidor-sheet', { method: 'POST' }),
  getMyReviews: () => request('/users/me/reviews'),
  getFollowedStores: () => request('/users/me/followed-stores'),
  getFeed: () => request('/users/me/feed'),
  getUser: (id) => request(`/users/${id}`),
  followUser: (id) => request(`/users/${id}/follow`, { method: 'POST' }),

  // Smoke List
  getSmokeList: (p = {}) => request(`/smoke-list?${new URLSearchParams(p)}`),
  addToSmokeList: (b) => request('/smoke-list', { method: 'POST', body: JSON.stringify(b) }),
  updateSmokeListItem: (id, b) => request(`/smoke-list/${id}`, { method: 'PUT', body: JSON.stringify(b) }),
  markSmokeListSmoked: (id) => request(`/smoke-list/${id}/mark-smoked`, { method: 'POST' }),
  deleteSmokeListItem: (id) => request(`/smoke-list/${id}`, { method: 'DELETE' }),
  checkSmokeList: (cigar_id) => request(`/smoke-list/check/${cigar_id}`),
  toggleSmokeList: (b) => request('/smoke-list/toggle', { method: 'POST', body: JSON.stringify(b) }),

  // Notifications
  getNotifications: () => request('/notifications'),
  getNotificationCount: () => request('/notifications/count'),
  markNotificationRead: (id) => request(`/notifications/${id}/read`, { method: 'POST' }),
  markAllNotificationsRead: () => request('/notifications/mark-all-read', { method: 'POST' }),

  // Place pages: the shops in one city or one state
  getPlaces: () => request('/places'),
  getPlace: (slug) => request(`/places/${encodeURIComponent(slug)}`),

  // Deals
  getDeals: () => request('/deals'),

  // Cigar Images
  getCigarImages: (cigarId) => request(`/cigars/${cigarId}/images`),
  uploadCigarImage: (cigarId, formData) => {
    const t = getToken();
    return fetch(`${BASE}/cigars/${cigarId}/images`, {
      method: 'POST',
      headers: t ? { Authorization: `Bearer ${t}` } : {},
      body: formData,
    }).then(async r => { const d = await r.json(); if (!r.ok) throw new Error(d.error || 'Upload failed'); return d; });
  },
  setCigarImageDefault: (imageId) => request(`/images/${imageId}/set-default`, { method: 'PATCH' }),
  deleteCigarImage: (imageId) => request(`/images/${imageId}`, { method: 'DELETE' }),

  // Inventory Import
  importPreview: (storeId, formData) => {
    const t = getToken();
    return fetch(`${BASE}/stores/${storeId}/import/preview`, {
      method: 'POST',
      headers: t ? { Authorization: `Bearer ${t}` } : {},
      body: formData,
    }).then(async r => { const d = await r.json(); if (!r.ok) throw new Error(d.error || 'Import failed'); return d; });
  },
  importConfirm: (storeId, rows) => request(`/stores/${storeId}/import/confirm`, { method: 'POST', body: JSON.stringify({ rows }) }),

  // Recommendations
  getRecommendations: () => request('/users/me/recommendations'),

  // Review Photos
  uploadReviewPhoto: (reviewId, formData) => {
    const t = getToken();
    return fetch(`${BASE}/reviews/${reviewId}/photo`, {
      method: 'PATCH',
      headers: t ? { Authorization: `Bearer ${t}` } : {},
      body: formData,
    }).then(async r => { const d = await r.json(); if (!r.ok) throw new Error(d.error || 'Upload failed'); return d; });
  },

  // Smoke Log Import
  importSmokeLogPreview: (formData) => {
    const t = getToken();
    return fetch(`${BASE}/users/me/import-smoke-log/preview`, {
      method: 'POST',
      headers: t ? { Authorization: `Bearer ${t}` } : {},
      body: formData,
    }).then(async r => { const d = await r.json(); if (!r.ok) throw new Error(d.error || 'Preview failed'); return d; });
  },
  importSmokeLogConfirm: (rows) => request('/users/me/import-smoke-log/confirm', { method: 'POST', body: JSON.stringify({ rows }) }),

  // Admin
  adminGetStats: () => request('/admin/stats'),
  adminGetVerifications: (status) => request(`/admin/verifications${status ? `?status=${status}` : ''}`),
  adminApproveVerification: (id, notes) => request(`/admin/verifications/${id}/approve`, { method: 'POST', body: JSON.stringify({ admin_notes: notes }) }),
  adminRejectVerification: (id, notes) => request(`/admin/verifications/${id}/reject`, { method: 'POST', body: JSON.stringify({ admin_notes: notes }) }),
  adminGetStores: () => request('/admin/stores'),
  adminToggleVerified: (id, verified) => request(`/admin/stores/${id}/verified`, { method: 'PATCH', body: JSON.stringify({ verified }) }),
  adminGetClaims: (status) => request(`/admin/claims${status ? `?status=${status}` : ''}`),
  adminApproveClaim: (id, notes) => request(`/admin/claims/${id}/approve`, { method: 'POST', body: JSON.stringify({ admin_notes: notes }) }),
  adminRejectClaim: (id, notes) => request(`/admin/claims/${id}/reject`, { method: 'POST', body: JSON.stringify({ admin_notes: notes }) }),
  adminGetListings: (p = {}) => request(`/admin/listings?${new URLSearchParams(p)}`),
  adminSetListing: (id, b) => request(`/admin/stores/${id}/visible`, { method: 'PATCH', body: JSON.stringify(b) }),
  // Take a claim back. There was no way to undo an approval: a claim granted
  // to the wrong person left that account in control of the listing for good,
  // and the only alternative was deleting the row.
  adminUnclaimStore: (id, reason) => request(`/admin/stores/${id}/unclaim`, { method: 'POST', body: JSON.stringify({ reason }) }),
  // Correct a listing's phone or website by hand, rather than only being able
  // to blank a dead link.
  adminSetContact: (id, b) => request(`/admin/stores/${id}/contact`, { method: 'PATCH', body: JSON.stringify(b) }),
  adminGetReports: (status) => request(`/admin/reports${status ? `?status=${status}` : ''}`),
  adminUpdateReport: (id, b) => request(`/admin/reports/${id}`, { method: 'PATCH', body: JSON.stringify(b) }),
  adminGetUsers: () => request('/admin/users'),

  // Closed / likely-closed listings. The queue lists them; confirm takes the
  // shop off the map for good, reopen puts it back and marks it decided.
  adminGetClosures: (p = {}) => request(`/admin/closures?${new URLSearchParams(p)}`),
  adminConfirmClosure: (id, b = {}) => request(`/admin/closures/${id}/confirm`, { method: 'POST', body: JSON.stringify(b) }),
  adminReopenStore: (id, b = {}) => request(`/admin/closures/${id}/reopen`, { method: 'POST', body: JSON.stringify(b) }),

  // Cigar catalog management
  adminGetCigars: () => request('/admin/cigars'),
  adminCreateCigar: (b) => request('/admin/cigars', { method: 'POST', body: JSON.stringify(b) }),
  adminUpdateCigar: (id, b) => request(`/admin/cigars/${id}`, { method: 'PUT', body: JSON.stringify(b) }),
  adminDeleteCigar: (id) => request(`/admin/cigars/${id}`, { method: 'DELETE' }),
  adminGetCigarVitolas: (id) => request(`/admin/cigars/${id}/vitolas`),
  adminAddVitola: (cigarId, b) => request(`/admin/cigars/${cigarId}/vitolas`, { method: 'POST', body: JSON.stringify(b) }),
  adminUpdateVitola: (id, b) => request(`/admin/vitolas/${id}`, { method: 'PUT', body: JSON.stringify(b) }),
  adminDeleteVitola: (id) => request(`/admin/vitolas/${id}`, { method: 'DELETE' }),

  // Sheet sync
  syncSheet: (storeId) => request(`/stores/${storeId}/sync-sheet`, { method: 'POST' }),

  // Community
  getCommunityPosts: (storeId) => request(`/stores/${storeId}/community`),
  createCommunityPost: (storeId, b) => request(`/stores/${storeId}/community`, { method: 'POST', body: JSON.stringify(b) }),
  pinCommunityPost: (postId) => request(`/community/${postId}/pin`, { method: 'PATCH' }),
  deleteCommunityPost: (postId) => request(`/community/${postId}`, { method: 'DELETE' }),
  likePost: (postId) => request(`/community/${postId}/like`, { method: 'POST' }),
  getReplies: (postId) => request(`/community/${postId}/replies`),
  postReply: (postId, content) => request(`/community/${postId}/replies`, { method: 'POST', body: JSON.stringify({ content }) }),
  deleteReply: (postId, replyId) => request(`/community/${postId}/replies/${replyId}`, { method: 'DELETE' }),

  // Events
  getStoreEvents: (storeId) => request(`/stores/${storeId}/events`),
  createStoreEvent: (storeId, b) => request(`/stores/${storeId}/events`, { method: 'POST', body: JSON.stringify(b) }),
  deleteStoreEvent: (storeId, eventId) => request(`/stores/${storeId}/events/${eventId}`, { method: 'DELETE' }),
  rsvpEvent: (eventId, status) => request(`/events/${eventId}/rsvp`, { method: 'POST', body: JSON.stringify({ status }) }),
  getCalendarEvents: () => request('/events/calendar'),
};
