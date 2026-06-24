import axios from 'axios';

const api = axios.create({
  baseURL: 'https://neighbour-backend-62bm.onrender.com/api',
});

// Interceptor to add JWT token from localStorage to headers automatically
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)  
);

export default api;
