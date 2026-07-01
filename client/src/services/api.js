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
  searchStores: (p = {}) => request(`/stores?${new URLSearchParams(p)}`),
  getStoreCities: () => request('/stores/cities'),
  getStore: (id) => request(`/stores/${id}`),
  getStoreInventory: (id, p = {}) => request(`/stores/${id}/inventory?${new URLSearchParams(p)}`),
  createStore: (b) => request('/stores', { method: 'POST', body: JSON.stringify(b) }),
  updateStore: (id, b) => request(`/stores/${id}`, { method: 'PUT', body: JSON.stringify(b) }),
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

  // Smoke List
  getSmokeList: (p = {}) => request(`/smoke-list?${new URLSearchParams(p)}`),
  addToSmokeList: (b) => request('/smoke-list', { method: 'POST', body: JSON.stringify(b) }),
  updateSmokeListItem: (id, b) => request(`/smoke-list/${id}`, { method: 'PUT', body: JSON.stringify(b) }),
  markSmokeListSmoked: (id) => request(`/smoke-list/${id}/mark-smoked`, { method: 'POST' }),
  deleteSmokeListItem: (id) => request(`/smoke-list/${id}`, { method: 'DELETE' }),

  // Notifications
  getNotifications: () => request('/notifications'),
  getNotificationCount: () => request('/notifications/count'),
  markNotificationRead: (id) => request(`/notifications/${id}/read`, { method: 'POST' }),
  markAllNotificationsRead: () => request('/notifications/mark-all-read', { method: 'POST' }),

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

  // Admin
  adminGetStats: () => request('/admin/stats'),
  adminGetVerifications: (status) => request(`/admin/verifications${status ? `?status=${status}` : ''}`),
  adminApproveVerification: (id, notes) => request(`/admin/verifications/${id}/approve`, { method: 'POST', body: JSON.stringify({ admin_notes: notes }) }),
  adminRejectVerification: (id, notes) => request(`/admin/verifications/${id}/reject`, { method: 'POST', body: JSON.stringify({ admin_notes: notes }) }),
  adminGetStores: () => request('/admin/stores'),
  adminToggleVerified: (id, verified) => request(`/admin/stores/${id}/verified`, { method: 'PATCH', body: JSON.stringify({ verified }) }),
  adminGetUsers: () => request('/admin/users'),

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
