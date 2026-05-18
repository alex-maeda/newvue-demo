const fs = require('fs');
const path = require('path');

const targetDirs = [
    'c:\\Users\\addas\\OneDrive\\Work\\NewVue\\Cockpit\\Summarization_Radiology\\Reports\\Patient_4_86_F',
    'c:\\Users\\addas\\OneDrive\\Work\\NewVue\\Cockpit\\Summarization_Radiology\\Reports\\Patient_5_69_F'
];

const regex = /(^|\n)?([ \t]*)(\*\*\s*(?:HISTORY|TECHNIQUE|FINDINGS)\s*\*\*|COMPARISON:?)/gi;

let totalFormatted = 0;

targetDirs.forEach(targetDir => {
    if (!fs.existsSync(targetDir)) return;
    const files = fs.readdirSync(targetDir).filter(f => f.endsWith('.txt'));
    let formattedCount = 0;

    files.forEach(f => {
        const filePath = path.join(targetDir, f);
        let content = fs.readFileSync(filePath, 'utf8');
        
        const newContent = content.replace(regex, (match, p1, p2, p3) => {
            if (p1 !== undefined) {
                return match;
            } else {
                return '\n' + p3;
            }
        });

        if (newContent !== content) {
            fs.writeFileSync(filePath, newContent);
            console.log('Formatted ' + path.join(path.basename(targetDir), f));
            formattedCount++;
            totalFormatted++;
        }
    });

    console.log(`Directory ${path.basename(targetDir)}: Formatted ${formattedCount} out of ${files.length} files`);
});

console.log(`Total files formatted across all dirs: ${totalFormatted}`);
