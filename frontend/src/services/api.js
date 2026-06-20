// src/services/api.js
import axios from 'axios'

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '',
  headers: {
    'Content-Type': 'application/json',
  },
})

export const shortenUrl = async (originalUrl) => {
  const response = await api.post('/api/shorten', { original_url: originalUrl })
  return response.data
}

export const getLinks = async () => {
  const response = await api.get('/api/links')
  return response.data
}

export default api
