const fs = require('fs');
const path = require('path');

const viewsDir = path.join(__dirname, 'views');
const files = fs.readdirSync(viewsDir).filter(f => f.endsWith('.ejs'));

files.forEach(file => {
    const filePath = path.join(viewsDir, file);
    let content = fs.readFileSync(filePath, 'utf8');
    if (content.includes('%%>')) {
        content = content.replace(/%%>/g, '%>');
        fs.writeFileSync(filePath, content, 'utf8');
        console.log('Fixed closing tags in', file);
    }
});
