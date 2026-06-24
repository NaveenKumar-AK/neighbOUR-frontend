import React, { useState, useEffect, useContext, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import api from '../utils/api';
import { AuthContext } from '../context/AuthContext';
import 'leaflet/dist/leaflet.css';

// Fix Leaflet broken default icon
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl:       'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl:     'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

// Helper: Calculate distance in KM
const calculateDistance = (lat1, lon1, lat2, lon2) => {
  const R = 6371; // Radius of the earth in km
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) * 
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c; // Distance in km
};

function ChangeView({ center, zoom }) {
  const map = useMap();
  useEffect(() => {
    map.setView(center, zoom);
  }, [center, zoom, map]);
  return null;
}

function ProviderDashboard() {
  const { user, setUser } = useContext(AuthContext);
  const navigate = useNavigate();

  const [jobs, setJobs] = useState([]);
  const [isFetchingLocation, setIsFetchingLocation] = useState(false);
  const [loadingJobs, setLoadingJobs] = useState(false);
  const [address, setAddress] = useState("Determining location...");
  const [radius, setRadius] = useState(10000);
  const [stats, setStats] = useState({ jobsToday: 0, earningsToday: 0 });
  const [location, setLocation] = useState(user?.location?.coordinates ? 
    { lat: user.location.coordinates[1], lng: user.location.coordinates[0] } : 
    { lat: 20.5937, lng: 78.9629 }
  );

  // Reverse Geocoding
  const fetchAddress = async (lat, lng) => {
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`);
      const data = await res.json();
      const addr = data.address;
      const city = addr.city || addr.town || addr.village || addr.suburb || "Unknown City";
      const state = addr.state || "";
      setAddress(`📍 ${city}${state ? `, ${state}` : ""}`);
    } catch (err) {
      setAddress("📍 Location Set");
    }
  };

  const fetchNearbyJobs = useCallback(async (lat, lng, rad) => {
    if (!lat || !lng) return;
    setLoadingJobs(true);
    try {
      const res = await api.get(`/jobs/nearby?lat=${lat}&lng=${lng}&maxDistance=${rad}`);
      setJobs(res.data);
    } catch (err) {
      console.error("Failed to fetch nearby jobs", err);
    } finally {
      setLoadingJobs(false);
    }
  }, []);

  const fetchStats = useCallback(async () => {
    try {
      const res = await api.get('/jobs/history');
      const today = new Date().toDateString();
      const todayJobs = res.data.filter(j => new Date(j.createdAt).toDateString() === today);
      const earnings = todayJobs.reduce((acc, curr) => curr.status === 'completed' ? acc + curr.budget : acc, 0);
      setStats({ jobsToday: todayJobs.length, earningsToday: earnings });
    } catch (err) { console.error(err); }
  }, []);

  useEffect(() => {
    fetchStats();
    if (location.lat !== 20.5937) {
      fetchAddress(location.lat, location.lng);
      if (user?.availability) fetchNearbyJobs(location.lat, location.lng, radius);
    }
  }, [fetchStats, fetchNearbyJobs, user?.availability, location, radius]);

  // Sort and enrich jobs
  const sortedJobs = useMemo(() => {
    return jobs.map(job => ({
      ...job,
      distance: calculateDistance(location.lat, location.lng, job.customer?.location?.coordinates[1], job.customer?.location?.coordinates[0]),
      isNew: (new Date() - new Date(job.createdAt)) < (30 * 60 * 1000), // < 30 mins
      isUrgent: job.budget > 1500 || (new Date() - new Date(job.createdAt)) < (10 * 60 * 1000)
    })).sort((a, b) => a.distance - b.distance);
  }, [jobs, location]);

  const toggleAvailability = async () => {
    try {
      const newStatus = !user.availability;
      const res = await api.patch('/users/profile', { availability: newStatus });
      setUser(res.data);
      if (newStatus) fetchNearbyJobs(location.lat, location.lng, radius);
    } catch (err) { alert("Status update failed"); }
  };

  const useCurrentLocation = () => {
    if (!navigator.geolocation) return alert("Geolocation not supported");
    setIsFetchingLocation(true);
    navigator.geolocation.getCurrentPosition(async (pos) => {
      const { latitude, longitude } = pos.coords;
      const newLoc = { lat: latitude, lng: longitude };
      setLocation(newLoc);
      try {
        const res = await api.patch('/users/profile', {
          location: { type: 'Point', coordinates: [longitude, latitude] }
        });
        setUser(res.data);
      } catch (err) { console.error(err); }
      setIsFetchingLocation(false);
    }, (err) => {
      alert(err.message);
      setIsFetchingLocation(false);
    });
  };

  const handleAcceptJob = async (id) => {
    try {
      await api.patch(`/jobs/${id}/accept`);
      navigate(`/chat/${id}`);
    } catch (err) { alert(err.response?.data?.error || 'Failed to accept job'); }
  };

  return (
    <div style={{ fontSize: '0.85rem' }}>
      {/* Header Area */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.25rem' }}>
        <div>
          <h2 style={{ fontSize: '1.4rem', fontWeight: 800, margin: 0 }}>Hi, {user?.name}</h2>
          <div style={{ color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '0.4rem', marginTop: '0.2rem' }}>
            {isFetchingLocation ? <span style={{fontSize: '0.75rem'}}>⏳ Fetching location...</span> : <span>{address}</span>}
          </div>
        </div>
        
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', background: 'white', padding: '0.5rem 1rem', borderRadius: '10px', border: '1px solid var(--border)' }}>
            <span style={{ fontWeight: 700, fontSize: '0.75rem', color: user?.availability ? 'var(--success)' : 'var(--text-muted)' }}>
               {user?.availability ? 'ONLINE' : 'OFFLINE'}
            </span>
            <div onClick={toggleAvailability} style={{ width: '40px', height: '20px', background: user?.availability ? 'var(--success)' : '#D1D5DB', borderRadius: '15px', position: 'relative', cursor: 'pointer', transition: '0.3s' }}>
              <div style={{ width: '16px', height: '16px', background: 'white', borderRadius: '50%', position: 'absolute', top: '2px', left: user?.availability ? '22px' : '2px', transition: '0.3s' }} />
            </div>
          </div>
          <button onClick={useCurrentLocation} disabled={isFetchingLocation} className="btn btn-secondary" style={{ padding: '0.3rem 0.8rem', fontSize: '0.75rem' }}>
            <i className="bi bi-geo-alt-fill"></i> {isFetchingLocation ? 'Locating...' : 'Update Location'}
          </button>
        </div>
      </div>

      {/* Stats Area */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.75rem', marginBottom: '1.25rem' }}>
        {[
          { label: 'JOBS TODAY', val: stats.jobsToday, color: 'var(--primary)', icon: 'bi-briefcase' },
          { label: 'EARNINGS', val: `₹${stats.earningsToday}`, color: 'var(--success)', icon: 'bi-wallet2' },
          { label: 'RATING', val: user?.rating?.toFixed(1) || '0.0', color: '#F59E0B', icon: 'bi-star-fill' }
        ].map(s => (
          <div key={s.label} className="card" style={{ margin: 0, padding: '0.75rem', borderLeft: `3px solid ${s.color}` }}>
            <div style={{ fontSize: '0.65rem', fontWeight: 700, color: 'var(--text-muted)' }}>{s.label}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginTop: '0.2rem' }}>
              <i className={`bi ${s.icon}`} style={{ color: s.color, fontSize: '0.9rem' }}></i>
              <span style={{ fontSize: '1.1rem', fontWeight: 800 }}>{s.val}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Radius Selector */}
      <div className="card" style={{ padding: '0.6rem 1rem', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
        <i className="bi bi-funnel-fill" style={{color: 'var(--text-muted)'}}></i>
        <span style={{fontWeight: 600, fontSize: '0.8rem'}}>Search Radius:</span>
        <select value={radius} onChange={e => setRadius(+e.target.value)} style={{border: 'none', background: 'none', fontWeight: 700, color: 'var(--primary)', cursor: 'pointer', outline: 'none'}}>
          <option value={5000}>5 Kilometers</option>
          <option value={10000}>10 Kilometers</option>
          <option value={20000}>20 Kilometers</option>
          <option value={50000}>50 Kilometers</option>
        </select>
        {user?.availability && !loadingJobs && <span style={{marginLeft: 'auto', fontSize: '0.75rem', color: 'var(--success)', fontWeight: 600}}>
          <i className="bi bi-check-circle-fill"></i> {jobs.length} jobs found nearby
        </span>}
      </div>

      {/* Map Section */}
      <div style={{ height: '320px', borderRadius: '12px', overflow: 'hidden', border: '1px solid var(--border)', marginBottom: '1.5rem', position: 'relative' }}>
        <MapContainer center={[location.lat, location.lng]} zoom={13} style={{ height: '100%', width: '100%' }}>
          <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
          <ChangeView center={[location.lat, location.lng]} zoom={13} />
          
          <Marker position={[location.lat, location.lng]}>
            <Popup><strong>You are here</strong></Popup>
          </Marker>

          {sortedJobs.map(job => (
            <Marker 
              key={job._id} 
              position={[job.customer?.location?.coordinates[1], job.customer?.location?.coordinates[0]]}
              icon={new L.Icon({
                iconUrl: 'https://cdn-icons-png.flaticon.com/512/5836/5836477.png',
                iconSize: [28, 28],
                iconAnchor: [14, 28]
              })}
            >
              <Popup>
                <div style={{ fontSize: '0.8rem', minWidth: '140px' }}>
                  <h4 style={{ margin: '0 0 0.3rem 0', fontSize: '0.9rem' }}>{job.category}</h4>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                    <span>📍 {job.distance.toFixed(1)} km</span>
                    <span style={{fontWeight: 700}}>₹{job.budget}</span>
                  </div>
                  <button onClick={() => handleAcceptJob(job._id)} className="btn btn-primary" style={{ width: '100%', padding: '0.3rem', fontSize: '0.75rem' }}>View Job</button>
                </div>
              </Popup>
            </Marker>
          ))}
        </MapContainer>
        {loadingJobs && (
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(255,255,255,0.6)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.8rem', fontWeight: 600 }}>
             <i className="bi bi-arrow-repeat spin" style={{marginRight: '0.5rem'}}></i> Scanning area...
          </div>
        )}
      </div>

      {/* Jobs Feed */}
      <h3 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '1rem' }}>
        <i className="bi bi-lightning-fill" style={{color: '#F59E0B'}}></i> Live Job Feed
      </h3>

      {!user?.availability ? (
        <div style={{ textAlign: 'center', padding: '3rem', background: 'white', borderRadius: '12px', border: '1px dashed var(--border)' }}>
          <i className="bi bi-moon-stars" style={{fontSize: '2rem', color: '#94A3B8'}}></i>
          <p style={{ marginTop: '1rem', color: 'var(--text-muted)' }}>You are currently offline.</p>
          <button onClick={toggleAvailability} className="btn btn-primary btn-sm">Go Online</button>
        </div>
      ) : sortedJobs.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '3rem', background: 'white', borderRadius: '12px', border: '1px dashed var(--border)' }}>
          <i className="bi bi-search" style={{fontSize: '2rem', color: '#94A3B8'}}></i>
          <p style={{ marginTop: '1rem', color: 'var(--text-muted)' }}>No jobs nearby. Try increasing your radius.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', maxHeight: '500px', overflowY: 'auto', paddingRight: '0.5rem' }}>
          {sortedJobs.map(job => (
            <div key={job._id} className="card" style={{ 
              margin: 0, padding: '1rem', display: 'flex', flexDirection: 'row', gap: '1rem', 
              border: job.isUrgent ? '1.5px solid #FEE2E2' : '1px solid var(--border)',
              background: job.isUrgent ? '#FEF2F2' : 'white',
              transition: '0.2s'
            }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '0.4rem', flexWrap: 'wrap' }}>
                  {job.isUrgent && <span style={{ background: '#EF4444', color: 'white', fontSize: '0.65rem', padding: '0.1rem 0.4rem', borderRadius: '4px', fontWeight: 700 }}>URGENT</span>}
                  {job.isNew && <span style={{ background: 'var(--primary)', color: 'white', fontSize: '0.65rem', padding: '0.1rem 0.4rem', borderRadius: '4px', fontWeight: 700 }}>NEW</span>}
                  <span style={{ background: '#F1F5F9', color: '#475569', fontSize: '0.65rem', padding: '0.1rem 0.4rem', borderRadius: '4px', fontWeight: 600 }}>{job.category}</span>
                </div>
                
                <h4 style={{ fontSize: '0.95rem', fontWeight: 700, margin: '0 0 0.2rem 0' }}>{job.customer?.name}</h4>
                <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem', display: 'flex', gap: '0.8rem' }}>
                   <span><i className="bi bi-geo-alt"></i> {job.distance.toFixed(1)} km away</span>
                   <span><i className="bi bi-clock"></i> {new Date(job.createdAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                </div>
                <p style={{ fontSize: '0.8rem', marginTop: '0.6rem', color: '#475569', display: '-webkit-box', WebkitLineClamp: '2', WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                  {job.description}
                </p>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', justifyContent: 'space-between', minWidth: '100px' }}>
                <div style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--primary)' }}>₹{job.budget}</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', width: '100%' }}>
                  <button onClick={() => handleAcceptJob(job._id)} className="btn btn-success" style={{ padding: '0.4rem', fontSize: '0.75rem', width: '100%' }}>Accept</button>
                  <button onClick={() => navigate(`/chat/${job._id}`)} className="btn btn-secondary" style={{ padding: '0.4rem', fontSize: '0.75rem', width: '100%' }}>Details</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      <style>{`
        .spin { animation: spin 1s linear infinite; display: inline-block; }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: #f1f1f1; }
        ::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 10px; }
      `}</style>
    </div>
  );
}

export default ProviderDashboard;


