import axios from 'axios';

/** The API's public endpoints (the demo widget). Same origin: nginx on directmate.app proxies /api to the API. */
export const publicApi = axios.create({
  baseURL: '/api',
});
