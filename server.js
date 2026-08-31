const express = require('express');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const app = express();
const PORT = process.env.PORT || 8000;

// Statik HTML ve JS dosyalarını dışarı aç
app.use(express.static(path.join(__dirname)));

// 81 İl Koordinat Veritabanı [Boylam, Enlem]
const CITY_COORDINATES = {
    "adana": [35.3213, 37.0000], "adiyaman": [38.2763, 37.7644], "afyonkarahisar": [30.5567, 38.7507],
    "agri": [43.0503, 39.7191], "amasya": [35.8353, 40.6499], "ankara": [32.8597, 39.9334],
    "antalya": [30.7133, 36.8969], "artvin": [41.8183, 41.1828], "aydin": [27.8456, 37.8560],
    "balikesir": [27.8826, 39.6484], "bilecik": [29.9793, 40.1501], "bingol": [40.4939, 38.8854],
    "bitlis": [42.1095, 38.4006], "bolu": [31.6082, 40.7358], "burdur": [30.2889, 37.7203],
    "bursa": [29.0610, 40.1885], "canakkale": [26.4064, 40.1553], "cankiri": [33.6162, 40.6013],
    "corum": [34.9537, 40.5506], "denizli": [29.0875, 37.7765], "diyarbakir": [40.2306, 37.9144],
    "edirne": [26.5557, 41.6772], "elazig": [39.2264, 38.6810], "erzincan": [39.4901, 39.7500],
    "erzurum": [41.2769, 39.9043], "eskisehir": [30.5256, 39.7767], "gaziantep": [37.3825, 37.0662],
    "giresun": [38.3895, 40.9128], "gumushane": [39.4803, 40.4602], "hakkari": [43.7368, 37.5833],
    "hatay": [36.1606, 36.2023], "isparta": [30.5537, 37.7648], "mersin": [34.6415, 36.8121],
    "istanbul": [28.9784, 41.0082], "izmir": [27.1428, 38.4237], "kars": [43.0975, 40.6013],
    "kastamonu": [33.7765, 41.3887], "kayseri": [35.4853, 38.7205], "kirklareli": [27.2252, 41.7351],
    "kirsehir": [34.1709, 39.1425], "kocaeli": [29.9169, 40.7654], "konya": [32.4844, 37.8714],
    "kutahya": [29.9833, 39.4167], "malatya": [38.3095, 38.3552], "manisa": [27.4265, 38.6191],
    "kahramanmaras": [36.9371, 37.5858], "mardin": [40.7339, 37.3122], "mugla": [28.3665, 37.2153],
    "mus": [41.4910, 38.7432], "nevsehir": [34.7144, 38.6244], "nigde": [34.6857, 37.9667],
    "ordu": [37.8797, 40.9839], "rize": [40.5217, 41.0201], "sakarya": [30.4033, 40.7569],
    "samsun": [36.3360, 41.2928], "siirt": [41.9419, 37.9333], "sinop": [35.1531, 42.0231],
    "sivas": [37.0146, 39.7477], "tekirdag": [27.5110, 40.9780], "tokat": [36.5544, 40.3167],
    "trabzon": [39.7167, 41.0015], "tunceli": [39.5483, 39.1083], "sanliurfa": [38.7955, 37.1674],
    "usak": [29.4058, 38.6823], "van": [43.3833, 38.4891], "yozgat": [34.8044, 39.8181],
    "zonguldak": [31.7987, 41.4564], "aksaray": [34.0370, 38.3687], "bayburt": [40.2249, 40.2552],
    "karaman": [33.2150, 37.1811], "kirikkale": [33.5089, 39.8453], "batman": [41.1322, 37.8874],
    "sirnak": [42.4918, 37.5164], "bartin": [32.3375, 41.6358], "ardahan": [42.7022, 41.1105],
    "igdir": [44.0450, 39.9196], "yalova": [29.2769, 40.6500], "karabuk": [32.6276, 41.2061],
    "kilis": [37.1150, 36.7184], "osmaniye": [36.2415, 37.0742], "duzce": [31.1625, 40.8438]
};

const WMO_WEATHER_CODES = {
    0: ["Açık", "☀️"], 1: ["Açık / Az Bulutlu", "🌤️"], 2: ["Parçalı Bulutlu", "⛅"],
    3: ["Kapalı / Bulutlu", "☁️"], 45: ["Sisli", "🌫️"], 48: ["Yoğun Sisli", "🌁"],
    51: ["Hafif Çiseleyen", "🌦️"], 53: ["Çiseleyen Yağmur", "🌧️"], 61: ["Hafif Yağmurlu", "🌧️"],
    63: ["Yağmurlu", "🌧️"], 65: ["Şiddetli Yağmurlu", "🌧️"], 71: ["Hafif Kar", "🌨️"],
    73: ["Kar Yağışlı", "❄️"], 95: ["Gökgürültülü Fırtına", "🌩️"]
};

// Yardımcı Fonksiyon: HTTP/HTTPS İstekleri
function fetchJson(url) {
    return new Promise((resolve, reject) => {
        const client = url.startsWith('https') ? https : http;
        client.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
            });
        }).on('error', reject);
    });
}

// Canlı Hava Durumu
async function getWeather(lat, lon) {
    try {
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true&hourly=visibility&timezone=auto`;
        const data = await fetchJson(url);
        const current = data.current_weather || {};
        const temp = Math.round(current.temperature || 18);
        const code = current.weathercode || 0;
        const visMeters = (data.hourly && data.hourly.visibility) ? data.hourly.visibility[0] : 10000;
        const visKm = Math.max(1, Math.round(visMeters / 1000));
        const [cond, icon] = WMO_WEATHER_CODES[code] || ["Açık", "☀️"];
        return { temp: `${temp}°C`, condition: cond, visibility: `${visKm} km`, icon };
    } catch (e) {
        return { temp: "18°C", condition: "Açık", visibility: "10 km", icon: "🌤️" };
    }
}

// 1. Şehir Listesi API
app.get('/api/get-cities', (req, res) => {
    let targetDir = path.join(__dirname, "iller_kucuk");
    if (!fs.existsSync(targetDir)) targetDir = path.join(__dirname, "iller");

    let cities = [];
    if (fs.existsSync(targetDir)) {
        const files = fs.readdirSync(targetDir);
        files.forEach(f => {
            if (f.endsWith('.json')) {
                const cityId = f.replace('.json', '').toLowerCase();
                let cityName = cityId.charAt(0).toUpperCase() + cityId.slice(1);
                const replacements = {
                    "adiyaman": "Adıyaman", "agri": "Ağrı", "afyonkarahisar": "Afyonkarahisar",
                    "elazig": "Elazığ", "eskisehir": "Eskişehir", "kahramanmaras": "Kahramanmaraş",
                    "sanliurfa": "Şanlıurfa", "nigde": "Niğde", "kirikkale": "Kırıkkale",
                    "kirklareli": "Kırklareli", "kirsehir": "Kırşehir", "canakkale": "Çanakkale",
                    "cankiri": "Çankırı", "corum": "Çorum", "mus": "Muş", "usak": "Uşak",
                    "igdir": "Iğdır", "duzce": "Düzce", "sirnak": "Şırnak", "bingol": "Bingöl"
                };
                cityName = replacements[cityId] || cityName;
                cities.push({ id: cityId, name: cityName });
            }
        });
    }
    cities.sort((a, b) => a.name.localeCompare(b.name, 'tr', { sensitivity: 'base' }));
    res.json(cities);
});

// 2. Rota Hesaplama API
app.get('/api/get-route', async (req, res) => {
    try {
        const startCity = (req.query.start || '').toLowerCase();
        const endCity = (req.query.end || '').toLowerCase();

        let jsonPath = path.join(__dirname, "iller_kucuk", `${startCity}.json`);
        if (!fs.existsSync(jsonPath)) jsonPath = path.join(__dirname, "iller", `${startCity}.json`);

        let cityFileData = null;
        if (fs.existsSync(jsonPath)) {
            try { cityFileData = JSON.parse(fs.readFileSync(jsonPath, 'utf8')); } catch (e) {}
        }

        const c1Data = CITY_COORDINATES[startCity] || [35.3213, 37.0000];
        const c2Data = CITY_COORDINATES[endCity] || [32.8597, 39.9334];

        // OSRM Canlı Rota
        const osrmUrl = `http://router.project-osrm.org/route/v1/driving/${c1Data[0]},${c1Data[1]};${c2Data[0]},${c2Data[1]}?overview=full&geometries=geojson`;
        const osrmData = await fetchJson(osrmUrl);

        const rawCoords = osrmData.routes[0].geometry.coordinates;
        const realRouteCoords = rawCoords.map(pt => [pt[1], pt[0]]);
        const totalPts = realRouteCoords.length;

        const radarCnt = parseInt(cityFileData?.radar_sayisi || 5);
        const kontrolCnt = parseInt(cityFileData?.kontrol_sayisi || 5);
        const koridorCnt = parseInt(cityFileData?.koridor_sayisi || 20);
        const corridorsFromFile = cityFileData?.hiz_koridorlari || [];
        const breakdownData = cityFileData?.gecen_iller || [];

        // Radar Noktaları
        let radars = [];
        let rStep = totalPts / (radarCnt + 1);
        for (let i = 1; i <= radarCnt; i++) {
            let idx = Math.floor(i * rStep);
            if (idx < totalPts) radars.push({ name: `Gezici / Sabit Radar #${i}`, coords: realRouteCoords[idx] });
        }

        // Kontrol Noktaları
        let checkpoints = [];
        let cpStep = totalPts / (kontrolCnt + 1);
        for (let i = 1; i <= kontrolCnt; i++) {
            let idx = Math.floor(i * cpStep);
            if (idx < totalPts) checkpoints.push({ name: `Trafik Kontrol Noktası #${i}`, coords: realRouteCoords[idx] });
        }

        // Hız Koridorları
        let corridors = [];
        let numToDraw = Math.min(koridorCnt, 8);
        for (let i = 0; i < numToDraw; i++) {
            let sp = Math.floor(totalPts * (0.05 + i * 0.11));
            let ep = Math.floor(totalPts * (0.05 + i * 0.11 + 0.06));
            if (ep < totalPts) {
                let cLimit = corridorsFromFile[i]?.speed_limit || corridorsFromFile[i]?.speedLimit || [82, 70, 110][i % 3];
                corridors.push({
                    name: corridorsFromFile[i]?.name || `Otoyol Hız Koridoru #${i + 1}`,
                    speed_limit: parseInt(cLimit),
                    coords: realRouteCoords.slice(sp, ep)
                });
            }
        }

        const riskScore = Math.min(99, Math.round(((radarCnt + kontrolCnt + koridorCnt) / 45) * 100));

        // Canlı Hava Durumları
        const startWeather = await getWeather(c1Data[1], c1Data[0]);
        const endWeather = await getWeather(c2Data[1], c2Data[0]);

        res.json({
            status: "success",
            start: startCity.charAt(0).toUpperCase() + startCity.slice(1),
            end: endCity.charAt(0).toUpperCase() + endCity.slice(1),
            route_coords: realRouteCoords,
            radar_count: radarCnt,
            kontrol_count: kontrolCnt,
            koridor_count: koridorCnt,
            risk_score: riskScore,
            start_weather: startWeather,
            end_weather: endWeather,
            corridors,
            corridor_list: corridorsFromFile.length ? corridorsFromFile : corridors,
            radars,
            checkpoints,
            city_breakdown: breakdownData
        });

    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.listen(PORT, () => console.log(`🚀 Node.js Sunucusu Çalışıyor: http://localhost:${PORT}`));