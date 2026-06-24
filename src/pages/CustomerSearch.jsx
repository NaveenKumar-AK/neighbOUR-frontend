import React, { useState, useEffect, useContext } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { MapContainer, TileLayer, Marker, useMapEvents, Popup } from 'react-leaflet';
import L from 'leaflet';
import api from '../utils/api';
import { SERVICE_CATEGORIES, RADIUS_OPTIONS } from '../utils/constants';
import { AuthContext } from '../context/AuthContext';

// Fix Leaflet broken default icon in Vite/bundlers
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl:       'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl:     'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

// Custom Icons for Map View
const customerIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41]
});

const providerIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-green.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41]
});

// Inner component to capture map clicks
function LocationPicker({ onPick }) {
  useMapEvents({
    click(e) {
      onPick(e.latlng.lat, e.latlng.lng);
    }
  });
  return null;
}

function CustomerSearch() {
  const { user } = useContext(AuthContext);
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const [searchQuery, setSearchQuery] = useState(searchParams.get('q') || '');
  const [selectedCategory, setSelectedCategory] = useState(searchParams.get('category') || null);
  
  const [locationLabel, setLocationLabel] = useState('');
  const [locationInput, setLocationInput] = useState({ lat: '', lng: '' });
  const [showLocationModal, setShowLocationModal] = useState(false);
  const [radius, setRadius] = useState(5000);
  
  const [providers, setProviders] = useState([]);
  const [loadingProviders, setLoadingProviders] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [viewMode, setViewMode] = useState('list'); // 'list' or 'map'

  // Search History
  const [searchHistory, setSearchHistory] = useState([]);

  // Booking modal state
  const [showRequestForm, setShowRequestForm] = useState(null);
  const [requestForm, setRequestForm] = useState({ category: '', description: '', budget: '' });
  const [requestSent, setRequestSent] = useState(false);

  useEffect(() => {
    // Sync URL params to state
    if (searchParams.get('q')) setSearchQuery(searchParams.get('q'));
    if (searchParams.get('category')) setSelectedCategory(searchParams.get('category'));
    
    // Load history
    const history = JSON.parse(localStorage.getItem('searchHistory') || '[]');
    setSearchHistory(history);
  }, [searchParams]);

  const addToHistory = (query) => {
    if (!query) return;
    const newHistory = [query, ...searchHistory.filter(h => h !== query)].slice(0, 5);
    setSearchHistory(newHistory);
    localStorage.setItem('searchHistory', JSON.stringify(newHistory));
  };

  const fetchProviders = async (lat, lng, dist, isBackground = false) => {
    if (!isBackground) setLoadingProviders(true);
    setHasSearched(true);
    try {
      if (!isBackground) {
        await api.patch('/users/profile', {
          location: { type: 'Point', coordinates: [parseFloat(lng), parseFloat(lat)] }
        });
      }
      const res = await api.get(`/users/search-providers?lat=${lat}&lng=${lng}&maxDistance=${dist}`);
      setProviders(res.data);
    } catch {
      if (!isBackground) setProviders([]);
    } finally {
      if (!isBackground) setLoadingProviders(false);
    }
  };

  // Auto-fetch providers on mount/update if user profile has location coordinates saved
  useEffect(() => {
    if (user?.location?.coordinates && user.location.coordinates[0] !== 0 && user.location.coordinates[1] !== 0 && !locationInput.lat) {
      const lng = user.location.coordinates[0];
      const lat = user.location.coordinates[1];
      setLocationInput({ lat: lat.toString(), lng: lng.toString() });
      setLocationLabel(`Lat: ${lat.toFixed(4)}, Lng: ${lng.toFixed(4)}`);
      fetchProviders(lat, lng, radius);
    }
  }, [user]);

  // Real-time update: poll nearby providers in the background every 8 seconds
  useEffect(() => {
    if (!locationInput.lat || !locationInput.lng) return;
    const interval = setInterval(() => {
      fetchProviders(locationInput.lat, locationInput.lng, radius, true);
    }, 8000);
    return () => clearInterval(interval);
  }, [locationInput.lat, locationInput.lng, radius]);

  const handleSetLocation = () => {
    if (!locationInput.lat || !locationInput.lng) return;
    setLocationLabel(`Lat: ${parseFloat(locationInput.lat).toFixed(4)}...`);
    setShowLocationModal(false);
    fetchProviders(locationInput.lat, locationInput.lng, radius);
  };

  const filteredProviders = providers.filter(p => {
    const matchQuery = !searchQuery ||
      p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.skills?.some(s => s.toLowerCase().includes(searchQuery.toLowerCase()));
    const matchCat = !selectedCategory ||
      p.skills?.some(s => s.toLowerCase().includes(selectedCategory.toLowerCase()));
    return matchQuery && matchCat;
  });

  const handleCreateRequest = async (e) => {
    e.preventDefault();
    try {
      await api.post('/jobs', { ...requestForm, providerId: showRequestForm._id });
      setRequestSent(true);
      setTimeout(() => {
        setShowRequestForm(null);
        setRequestSent(false);
        setRequestForm({ category: '', description: '', budget: '' });
        navigate('/customer/history');
      }, 1800);
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to send request');
    }
  };

  return (
    <div>
      {/* SEARCH HEADER */}
      <div style={{ marginBottom: '1.5rem', display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'center' }}>
        <div style={{ position: 'relative', flex: '1 1 250px' }}>
          <span style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }}><i className="bi bi-search"></i></span>
          <input 
            type="text" 
            placeholder="Search providers or skills..." 
            value={searchQuery} 
            onChange={e => {
              setSearchQuery(e.target.value);
              setSearchParams(prev => { if (e.target.value) prev.set('q', e.target.value); else prev.delete('q'); return prev; }, {replace: true});
            }}
            onBlur={() => addToHistory(searchQuery)}
            className="form-input"
            style={{ paddingLeft: '2.5rem' }} 
          />
        </div>
        
        <button onClick={() => setShowLocationModal(true)} className="btn btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span><i className="bi bi-geo-alt-fill"></i></span> {locationLabel || 'Set Location'}
        </button>

        <select value={radius} onChange={e => { setRadius(+e.target.value); if (locationInput.lat) fetchProviders(locationInput.lat, locationInput.lng, +e.target.value); }}
          className="form-input" style={{ width: 'auto', minWidth: '120px' }}>
          {RADIUS_OPTIONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select>
      </div>

      {/* SEARCH HISTORY */}
      {searchHistory.length > 0 && !searchQuery && (
        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Recent:</span>
          {searchHistory.map(h => (
            <button key={h} onClick={() => { setSearchQuery(h); setSearchParams(prev => { prev.set('q', h); return prev; }); }} 
            className="badge" style={{ cursor: 'pointer', border: '1px solid var(--border)', background: 'var(--surface)' }}>
              {h}
            </button>
          ))}
        </div>
      )}

      {/* ACTIVE CATEGORY FILTER */}
      {selectedCategory && (
        <div style={{ marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <h3 style={{ fontSize: '1.1rem', margin: 0 }}>Showing: <strong>{selectedCategory}</strong></h3>
          <button onClick={() => { setSelectedCategory(null); setSearchParams(prev => { prev.delete('category'); return prev; }); }} 
            style={{ background: 'none', border: 'none', color: 'var(--danger)', fontSize: '0.85rem', cursor: 'pointer', fontWeight: 600 }}>
            <i className="bi bi-x-circle-fill"></i> Clear filter
          </button>
        </div>
      )}

      {/* STATES */}
      {loadingProviders && (
        <div style={{ textAlign: 'center', padding: '4rem', color: 'var(--text-muted)' }}>
          <div style={{ fontSize: '2rem', marginBottom: '1rem', animation: 'spin 2s linear infinite' }}><i className="bi bi-arrow-repeat"></i></div>
          <p>Finding nearby providers...</p>
        </div>
      )}

      {!loadingProviders && !hasSearched && (
        <div style={{ textAlign: 'center', padding: '4rem', color: 'var(--text-muted)', background: 'white', borderRadius: '16px', border: '1.5px dashed var(--border)' }}>
          <div style={{ fontSize: '3rem', marginBottom: '1rem' }}><i className="bi bi-geo-alt-fill"></i></div>
          <h3 style={{ fontWeight: 700, marginBottom: '0.5rem', color: 'var(--text)' }}>Location required</h3>
          <p style={{ fontSize: '0.95rem', marginBottom: '1.5rem' }}>We need your coordinates to find trusted providers near you.</p>
          <button onClick={() => setShowLocationModal(true)} className="btn btn-primary">Set My Location</button>
        </div>
      )}

      {!loadingProviders && hasSearched && filteredProviders.length === 0 && (
        <div style={{ textAlign: 'center', padding: '4rem', color: 'var(--text-muted)', background: 'white', borderRadius: '16px', border: '1.5px dashed var(--border)' }}>
          <div style={{ fontSize: '3rem', marginBottom: '1rem', color: 'var(--danger)' }}><i className="bi bi-emoji-frown"></i></div>
          <h3 style={{ fontWeight: 700, marginBottom: '0.5rem', color: 'var(--text)' }}>No providers found</h3>
          <p style={{ fontSize: '0.95rem' }}>Try increasing your radius or resetting your search filters.</p>
        </div>
      )}

      {/* VIEW MODE TOGGLE */}
      {hasSearched && filteredProviders.length > 0 && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '1.25rem' }}>
          <div style={{ display: 'flex', gap: '0.5rem', background: '#F1F5F9', padding: '0.25rem', borderRadius: '10px', border: '1px solid var(--border)' }}>
            <button 
              onClick={() => setViewMode('list')}
              style={{
                padding: '0.4rem 1rem', border: 'none', borderRadius: '8px', cursor: 'pointer',
                fontWeight: 600, fontSize: '0.8rem', transition: '0.2s',
                background: viewMode === 'list' ? 'white' : 'transparent',
                color: viewMode === 'list' ? 'var(--primary)' : 'var(--text-muted)',
                boxShadow: viewMode === 'list' ? '0 2px 4px rgba(0,0,0,0.05)' : 'none'
              }}
            >
              📋 List
            </button>
            <button 
              onClick={() => setViewMode('map')}
              style={{
                padding: '0.4rem 1rem', border: 'none', borderRadius: '8px', cursor: 'pointer',
                fontWeight: 600, fontSize: '0.8rem', transition: '0.2s',
                background: viewMode === 'map' ? 'white' : 'transparent',
                color: viewMode === 'map' ? 'var(--primary)' : 'var(--text-muted)',
                boxShadow: viewMode === 'map' ? '0 2px 4px rgba(0,0,0,0.05)' : 'none'
              }}
            >
              🗺️ Map
            </button>
          </div>
        </div>
      )}

      {/* PROVIDER GRID VIEW */}
      {(!loadingProviders && hasSearched && viewMode === 'list' && filteredProviders.length > 0) && (
        <div className="grid">
          {filteredProviders.map(p => (
            <div key={p._id} className="card" style={{ display: 'flex', flexDirection: 'column', padding: '1.25rem' }}>
              {/* Header */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1rem' }}>
                <div style={{ position: 'relative' }}>
                  <div style={{
                    width: '60px', height: '60px', borderRadius: '50%', flexShrink: 0,
                    background: 'linear-gradient(135deg, var(--primary), var(--primary-hover))',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: 'white', fontWeight: 800, fontSize: '1.5rem',
                    boxShadow: '0 4px 6px rgba(11,60,93,0.1)'
                  }}>
                    {p.name.charAt(0).toUpperCase()}
                  </div>
                  {p.availability && (
                    <div style={{
                      position: 'absolute', bottom: '0', right: '0',
                      width: '14px', height: '14px', background: 'var(--success)',
                      border: '2px solid white', borderRadius: '50%'
                    }} title="Online / Available" />
                  )}
                </div>
                
                <div style={{ flex: 1 }}>
                  <h3 className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                    {p.name} <span style={{ color: '#3B82F6', fontSize: '1rem' }} title="Verified"><i className="bi bi-patch-check-fill"></i></span>
                  </h3>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                    <span style={{ color: '#F59E0B' }}><i className="bi bi-star-fill"></i> {p.rating?.toFixed(1) || 'NEW'}</span>
                    <span>•</span>
                    <span>{p.jobsCompleted || 0} reviews</span>
                  </div>
                </div>
              </div>

              {/* Body */}
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginBottom: '0.75rem' }}>
                  {(p.skills?.length > 0 ? p.skills : ['General Helper']).slice(0,3).map(s => (
                    <span key={s} className="badge" style={{ background: 'var(--bg)', color: 'var(--text)' }}>{s}</span>
                  ))}
                  {p.skills?.length > 3 && <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>+{p.skills.length - 3}</span>}
                </div>
                {p.bio && <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '1rem', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{p.bio}</p>}
              </div>

              {/* Actions */}
              <div style={{ display: 'flex', gap: '0.5rem', marginTop: 'auto' }}>
                <button onClick={() => setShowRequestForm(p)} className="btn btn-accent" style={{ flex: 2 }}>Hire</button>
                <button onClick={() => navigate('/customer/messages')} className="btn btn-secondary" style={{ flex: 1 }}>Chat</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* PROVIDER MAP VIEW */}
      {!loadingProviders && hasSearched && viewMode === 'map' && filteredProviders.length > 0 && (
        <div style={{ height: '500px', borderRadius: '16px', overflow: 'hidden', border: '1.5px solid var(--border)', marginBottom: '2.5rem', position: 'relative', boxShadow: '0 4px 12px rgba(0,0,0,0.05)' }}>
          <MapContainer 
            center={[parseFloat(locationInput.lat), parseFloat(locationInput.lng)]} 
            zoom={13} 
            style={{ height: '100%', width: '100%' }}
          >
            <TileLayer
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              attribution='&copy; <a href="https://openstreetmap.org">OpenStreetMap</a>'
            />
            {/* Customer Marker */}
            <Marker 
              position={[parseFloat(locationInput.lat), parseFloat(locationInput.lng)]} 
              icon={customerIcon}
            >
              <Popup>
                <div style={{ fontSize: '0.85rem' }}>
                  <strong>Your Location</strong>
                </div>
              </Popup>
            </Marker>
            
            {/* Provider Markers */}
            {filteredProviders.map(p => {
              const pLng = p.location?.coordinates?.[0];
              const pLat = p.location?.coordinates?.[1];
              if (!pLat || !pLng) return null;
              return (
                <Marker 
                  key={p._id} 
                  position={[pLat, pLng]} 
                  icon={providerIcon}
                >
                  <Popup>
                    <div style={{ fontSize: '0.85rem', minWidth: '180px', padding: '0.2rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.4rem' }}>
                        <div style={{ width: '28px', height: '28px', borderRadius: '50%', background: 'linear-gradient(135deg, var(--primary), var(--primary-hover))', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 800, fontSize: '0.75rem' }}>
                          {p.name.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <strong style={{ display: 'block', fontSize: '0.9rem' }}>{p.name}</strong>
                          <span style={{ fontSize: '0.75rem', color: '#16A34A', fontWeight: 600 }}>Available</span>
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', marginBottom: '0.5rem', fontSize: '0.8rem' }}>
                        <span style={{ color: '#F59E0B' }}>★</span>
                        <span>{p.rating?.toFixed(1) || '0.0'}</span>
                        <span style={{ color: 'var(--text-muted)' }}>({p.jobsCompleted || 0} jobs)</span>
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem', marginBottom: '0.8rem' }}>
                        {(p.skills?.length > 0 ? p.skills.slice(0, 2) : ['Helper']).map(s => (
                          <span key={s} style={{ background: '#FFF7ED', color: 'var(--primary)', border: '1px solid #FED7AA', padding: '0.1rem 0.4rem', borderRadius: '12px', fontSize: '0.7rem', fontWeight: 600 }}>{s}</span>
                        ))}
                      </div>
                      <div style={{ display: 'flex', gap: '0.4rem' }}>
                        <button onClick={() => setShowRequestForm(p)} style={{ flex: 1, padding: '0.4rem', background: 'var(--primary)', color: 'white', border: 'none', borderRadius: '6px', fontWeight: 700, cursor: 'pointer', fontSize: '0.8rem' }}>
                          Book Now
                        </button>
                        <button onClick={() => navigate('/customer/messages')} style={{ padding: '0.4rem 0.6rem', background: 'var(--bg)', color: 'var(--text-muted)', border: '1px solid var(--border)', borderRadius: '6px', cursor: 'pointer', fontSize: '0.8rem' }}>
                          💬
                        </button>
                      </div>
                    </div>
                  </Popup>
                </Marker>
              );
            })}
          </MapContainer>
        </div>
      )}

      {/* LOCATION MODAL */}
      {showLocationModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
          <div style={{ background: 'white', borderRadius: '20px', padding: '1.75rem', maxWidth: '620px', width: '100%', boxShadow: '0 25px 50px rgba(0,0,0,0.25)' }}>
            <h3 style={{ fontWeight: 700, marginBottom: '0.35rem', fontSize: '1.2rem' }}><i className="bi bi-geo-alt-fill text-primary"></i> Set Your Location</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '1rem' }}>Click map or use GPS.</p>
            <button onClick={() => { if (navigator.geolocation) navigator.geolocation.getCurrentPosition(pos => setLocationInput({ lat: pos.coords.latitude, lng: pos.coords.longitude }), () => alert('GPS access denied.')); }}
              className="btn btn-secondary" style={{ width: '100%', marginBottom: '1rem', background: '#F0FDF4', color: '#15803D', borderColor: '#BBF7D0' }}>
              <i className="bi bi-crosshair"></i> Use GPS
            </button>
            <div style={{ borderRadius: '12px', overflow: 'hidden', border: '1px solid var(--border)', height: '250px', marginBottom: '1rem' }}>
              <MapContainer center={locationInput.lat ? [locationInput.lat, locationInput.lng] : [20.5937, 78.9629]} zoom={locationInput.lat ? 13 : 5} style={{ height: '100%', width: '100%' }} key={locationInput.lat + locationInput.lng}>
                <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                <LocationPicker onPick={(lat, lng) => setLocationInput({ lat: lat.toFixed(6), lng: lng.toFixed(6) })} />
                {locationInput.lat && locationInput.lng && <Marker position={[parseFloat(locationInput.lat), parseFloat(locationInput.lng)]} />}
              </MapContainer>
            </div>
            {locationInput.lat ? (
              <div style={{ padding: '0.75rem', background: 'var(--bg)', borderRadius: '8px', marginBottom: '1rem', fontSize: '0.85rem' }}>
                <i className="bi bi-pin-map-fill text-danger"></i> Lat {parseFloat(locationInput.lat).toFixed(4)}, Lng {parseFloat(locationInput.lng).toFixed(4)}
              </div>
            ) : null}
            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <button onClick={() => setShowLocationModal(false)} className="btn btn-secondary" style={{ flex: 1 }}>Cancel</button>
              <button onClick={handleSetLocation} disabled={!locationInput.lat} className="btn btn-primary" style={{ flex: 1 }}>Search</button>
            </div>
          </div>
        </div>
      )}

      {/* BOOKING MODAL */}
      {showRequestForm && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
          <div style={{ background: 'white', borderRadius: '20px', padding: '2rem', maxWidth: '480px', width: '100%', boxShadow: '0 25px 50px rgba(0,0,0,0.2)' }}>
            {requestSent ? (
               <div style={{ textAlign: 'center', padding: '1.5rem' }}>
                  <div style={{ fontSize: '3.5rem', marginBottom: '1rem', color: 'var(--success)' }}><i className="bi bi-check-circle-fill"></i></div>
                  <h3 style={{ fontWeight: 800 }}>Request Sent!</h3>
               </div>
            ) : (
              <>
                 <h3 style={{ marginBottom: '1.5rem', fontWeight: 700 }}>Book {showRequestForm.name}</h3>
                 <form onSubmit={handleCreateRequest} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    <div className="form-group" style={{ marginBottom: '0' }}>
                      <label className="form-label">Service Category</label>
                      <select className="form-input" value={requestForm.category} onChange={e => setRequestForm({...requestForm, category: e.target.value})} required>
                         <option value="">Select Category</option>
                         {SERVICE_CATEGORIES.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
                      </select>
                    </div>
                    <div className="form-group" style={{ marginBottom: '0' }}>
                      <label className="form-label">Budget (₹)</label>
                      <input type="number" className="form-input" value={requestForm.budget} onChange={e => setRequestForm({...requestForm, budget: e.target.value})} required />
                    </div>
                    <div className="form-group" style={{ marginBottom: '0' }}>
                      <label className="form-label">Description</label>
                      <textarea className="form-input" rows={3} value={requestForm.description} onChange={e => setRequestForm({...requestForm, description: e.target.value})} required />
                    </div>
                    <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1rem' }}>
                       <button type="button" onClick={() => setShowRequestForm(null)} className="btn btn-secondary" style={{ flex: 1 }}>Cancel</button>
                       <button type="submit" className="btn btn-accent" style={{ flex: 2 }}>Send Request</button>
                    </div>
                 </form>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default CustomerSearch;
