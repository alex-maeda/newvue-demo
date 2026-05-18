const fs = require('fs');
const path = require('path');

const sourceFile = 'c:\\Users\\addas\\OneDrive\\Work\\NewVue\\Cockpit\\Summarization_Radiology\\Reports\\Source_Patient_1_65_F.txt';
const targetDir = 'c:\\Users\\addas\\OneDrive\\Work\\NewVue\\Cockpit\\Summarization_Radiology\\Reports\\Patient_1_65_F';

if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
}

const lines = fs.readFileSync(sourceFile, 'utf8').split(/\r?\n/);

let currentReportLines = [];
let currentFilename = null;
let dateToTimeCounter = {};

const format0Regex = /^(\d{1,2}\/\d{1,2}\/\d{2,4})\s+(.+?)\s+(\d{1,2}:\d{2}\s*[AP]M)\s*$/i;
const format1Line1Regex = /^={5,}\s+(.+)$/;
const format1Line2Regex = /^Result Date:\s+(\d{1,2}\/\d{1,2}\/\d{2,4})$/i;
const format2Regex = /^Status:\s*Final result\s*\(Exam End:\s*(\d{1,2}\/\d{1,2}\/\d{2,4})\s+(\d{1,2}:\d{2}\s*[AP]M)\s*$/i;

function parseDate(dateStr) {
    let [month, day, year] = dateStr.split('/');
    if (year.length === 2) {
        year = '20' + year;
    }
    const mm = month.padStart(2, '0');
    const dd = day.padStart(2, '0');
    return `${year}-${mm}${dd}`;
}

function parseTime(timeStr) {
    const match = timeStr.trim().match(/^(\d{1,2}):(\d{2})\s*([AP]M)$/i);
    let hr = parseInt(match[1], 10);
    const min = match[2];
    const ampm = match[3].toUpperCase();
    
    if (ampm === 'PM' && hr < 12) {
        hr += 12;
    }
    if (ampm === 'AM' && hr === 12) {
        hr = 0;
    }
    return `${hr.toString().padStart(2, '0')}${min}`;
}

function getNextDefaultTime(dateStr) {
    if (!dateToTimeCounter[dateStr]) {
        dateToTimeCounter[dateStr] = 1200;
    } else {
        dateToTimeCounter[dateStr]++;
    }
    return dateToTimeCounter[dateStr].toString().padStart(4, '0');
}

function parseModalityAndRegion(text) {
    let t = text.toUpperCase();
    
    t = t.replace(/\s*(?:W|WO|W\/O|WITHOUT|NO|WO\/W)\s+CONTRAST/g, '')
         .replace(/\s+FRONTAL/g, '')
         .replace(/\s+PA\s+AND\s+LAT/g, '');
         
    let modality = 'UNK';
    let regionStr = t;
    
    if (t.startsWith('CTA ')) {
        modality = 'CT';
        regionStr = 'ANGIOGRAM' + t.substring(3);
    } else if (t.startsWith('ECHOCARDIOGRAM')) {
        modality = 'US';
        regionStr = t;
    } else {
        const modalities = ['CT', 'MRI', 'MR', 'XR', 'XT', 'US', 'FL', 'MG', 'NM', 'IR', 'ECHO'];
        for (let m of modalities) {
            if (t.startsWith(m + ' ')) {
                modality = m === 'MRI' ? 'MR' : (m === 'XT' ? 'XR' : (m === 'ECHO' ? 'US' : m));
                regionStr = t.substring(m.length).trim();
                break;
            }
        }
    }
    
    regionStr = regionStr.replace(/\bABD\b/g, 'ABDOMEN');
    regionStr = regionStr.replace(/\bPEL\b/g, 'PELVIS');
    
    let region = regionStr.replace(/[^A-Z0-9]/ig, '');
    
    return { modality, region };
}

function saveReport(filename, lines) {
    if (!filename || lines.length === 0) return;
    
    if (lines.join('').trim().length === 0) return;
    
    const outPath = path.join(targetDir, filename);
    fs.writeFileSync(outPath, lines.join('\n'));
    console.log(`Saved ${filename}`);
}

for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const cl = line.replace(/^\uFEFF/, '').trim();
    
    // Format 0
    const match0 = cl.match(format0Regex);
    if (match0) {
        if (currentFilename) saveReport(currentFilename, currentReportLines);
        currentReportLines = [];
        
        const dateStr = parseDate(match0[1]);
        const { modality, region } = parseModalityAndRegion(match0[2]);
        const timeStr = parseTime(match0[3]);
        
        currentFilename = `BIN-RPT-${dateStr}-${modality}${region}-${timeStr}.txt`;
        continue;
    }
    
    // Format 1
    const match1 = cl.match(format1Line1Regex);
    if (match1 && i + 1 < lines.length) {
        const nextLine = lines[i+1].replace(/^\uFEFF/, '').trim();
        const matchDate = nextLine.match(format1Line2Regex);
        if (matchDate) {
            if (currentFilename) saveReport(currentFilename, currentReportLines);
            currentReportLines = [];
            
            const dateStr = parseDate(matchDate[1]);
            const { modality, region } = parseModalityAndRegion(match1[1]);
            const timeStr = getNextDefaultTime(dateStr);
            
            currentFilename = `BIN-RPT-${dateStr}-${modality}${region}-${timeStr}.txt`;
            i++; // skip next line
            continue;
        }
    }
    
    // Format 2
    const match2 = cl.match(format2Regex);
    if (match2 && i >= 2) {
        let header1 = lines[i-1].replace(/^\uFEFF/, '').trim();
        let header2 = lines[i-2].replace(/^\uFEFF/, '').trim();
        
        let modalityLineStr = header2;
        let popCount = 2;
        
        if (header1.toUpperCase() !== 'RESULTS' && header1 !== '') {
            modalityLineStr = header1;
            popCount = 1;
        } else if (header2.toUpperCase() === 'RESULTS' || header2 === '') {
            modalityLineStr = lines[i-3].replace(/^\uFEFF/, '').trim();
            popCount = 3;
        }

        for (let j = 0; j < popCount; j++) {
            currentReportLines.pop();
        }
        
        if (currentFilename) saveReport(currentFilename, currentReportLines);
        currentReportLines = [];
        
        const dateStr = parseDate(match2[1]);
        const { modality, region } = parseModalityAndRegion(modalityLineStr);
        const timeStr = parseTime(match2[2]);
        
        currentFilename = `BIN-RPT-${dateStr}-${modality}${region}-${timeStr}.txt`;
        continue;
    }
    
    if (currentFilename) {
        currentReportLines.push(line);
    }
}

if (currentFilename) {
    saveReport(currentFilename, currentReportLines);
}
