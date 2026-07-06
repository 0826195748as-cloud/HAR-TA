const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { WebcastPushConnection } = require('tiktok-live-connector');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Statik dosyaları (index.html ve oyun varlıklarını) sunucu üzerinden dışarı aç
app.use(express.static(path.join(__dirname, './')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// TikTok Canlı Yayın Kullanıcı Adı
// Railway üzerinde Environment Variable (Ortam Değişkeni) olarak TIKTOK_USER tanımlayabilirsiniz.
// Eğer tanımlanmazsa varsayılan olarak aşağıdaki kullanıcı adını dener.
const TIKTOK_USERNAME = process.env.TIKTOK_USER || "lutfen_tiktok_kullanici_adinizi_girin";

let tiktokLiveConnection = null;

// TikTok bağlantısını başlatan fonksiyon
function connectToTikTok(username) {
    if (!username || username.includes("lutfen_tiktok")) {
        console.log("⚠️ Uyarı: Geçerli bir TikTok kullanıcı adı ayarlanmadı. Lütfen sunucu ayarlarından veya ortam değişkenlerinden güncelleyin.");
        return;
    }

    console.log(`🔌 TikTok Canlı Yayınına Bağlanılıyor: @${username}`);
    
    // Eğer halihazırda aktif bir bağlantı varsa önce onu temizle
    if (tiktokLiveConnection) {
        try {
            tiktokLiveConnection.disconnect();
        } catch (e) {
            console.error("Eski bağlantı kapatılırken hata oluştu:", e);
        }
    }

    tiktokLiveConnection = new WebcastPushConnection(username, {
        enableExtendedGiftInfo: true
    });

    tiktokLiveConnection.connect().then(state => {
        console.info(`✅ TikTok Canlı Yayınına Başarıyla Bağlanıldı! Oda ID: ${state.roomId}`);
        io.emit('server-status', { status: 'connected', username: username });
    }).catch(err => {
        console.error('❌ TikTok Bağlantı Hatası:', err.message);
        io.emit('server-status', { status: 'error', message: err.message });
    });

    // --- TIKTOK ETKİLEŞİM OLAYLARI (EVENTS) ---

    // 1. Chat/Yorum Olayı
    tiktokLiveConnection.on('chat', data => {
        console.log(`💬 [Yorum] ${data.uniqueId}: ${data.comment}`);
        io.emit('tiktok-chat', { 
            username: data.uniqueId, 
            comment: data.comment,
            nickname: data.nickname
        });
    });

    // 2. Beğeni (Like) Olayı
    tiktokLiveConnection.on('like', data => {
        console.log(`❤️ [Beğeni] ${data.uniqueId} -> ${data.likeCount} beğeni gönderdi.`);
        io.emit('tiktok-like', { 
            username: data.uniqueId, 
            count: data.likeCount 
        });
    });

    // 3. Hediye (Gift) Olayı
    tiktokLiveConnection.on('gift', data => {
        // Hediye kalıcı olarak gönderildiyse (streamback tamamlandıysa)
        if (data.giftPercent === 100 || !data.repeatEnd) {
            console.log(`🎁 [Hediye] ${data.uniqueId}: ${data.giftName} (Adet: ${data.repeatCount})`);
            io.emit('tiktok-gift', { 
                username: data.uniqueId, 
                giftName: data.giftName,
                count: data.repeatCount
            });
        }
    });

    // 4. Takip (Follow) Olayı
    tiktokLiveConnection.on('follow', data => {
        console.log(`👤 [Takip] ${data.uniqueId} seni takip etti!`);
        io.emit('tiktok-follow', { 
            username: data.uniqueId 
        });
    });

    // 5. Yayın Paylaşım Olayı
    tiktokLiveConnection.on('share', data => {
        console.log(`🔗 [Paylaşım] ${data.uniqueId} yayını paylaştı!`);
        io.emit('tiktok-share', { 
            username: data.uniqueId 
        });
    });

    // Sunucu bağlantısı koptuğunda
    tiktokLiveConnection.on('disconnected', () => {
        console.log("🔌 TikTok bağlantısı koptu.");
        io.emit('server-status', { status: 'disconnected' });
    });
}

// WebSocket Bağlantıları (Frontend -> Backend Haberleşmesi)
io.on('connection', (socket) => {
    console.log(`🖥️ Bir arayüz ekranı bağlandı. Soket ID: ${socket.id}`);
    
    // Arayüz ilk açıldığında sunucu durumunu bildir
    if (tiktokLiveConnection && tiktokLiveConnection.connectionState.isConnected) {
        socket.emit('server-status', { status: 'connected', username: TIKTOK_USERNAME });
    } else {
        socket.emit('server-status', { status: 'disconnected' });
    }

    // Arayüzden (Ayarlar panelinden) gelen yeni bağlantı talepleri için tetikleyici
    socket.on('request-tiktok-connect', (data) => {
        if (data && data.username) {
            connectToTikTok(data.username);
        }
    });
});

// Sunucuyu başlat
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Sunucu ${PORT} portunda başarıyla çalıştırıldı.`);
    console.log(`👉 Tarayıcıda açmak için: http://localhost:${PORT}`);
    
    // Eğer başlangıçta bir kullanıcı adı belirlendiyse otomatik bağlanmayı dene
    if (TIKTOK_USERNAME && TIKTOK_USERNAME !== "lutfen_tiktok_kullanici_adinizi_girin") {
        connectToTikTok(TIKTOK_USERNAME);
    }
});
