const fs = require('fs');
const path = require('path');
const acorn = require('acorn');
const walk = require('acorn-walk');

// Configuración
const directoryPath = './'; 
const excludeFiles = ['gen-header.ts', 'gen-header.js']; // Añade aquí lo que necesites excluir

/**
 * Procesa un archivo individual para generar su .d.ts
 */
function processFile(filePath) {
    const code = fs.readFileSync(filePath, 'utf8');
    const comments = [];
    
    const ast = acorn.parse(code, {
        ecmaVersion: 2020,
        sourceType: 'module',
        onComment: comments
    });

    let output = '';
    
    walk.simple(ast, {
        FunctionDeclaration(node) {
            // Busca comentarios previos en un rango de 150 caracteres
            const comment = comments.find(c => c.end < node.start && c.end >= node.start - 150);
            if (comment) output += `/**${comment.value}*/\n`;
            
            const params = node.params.map(p => p.name).join(', ');
            output += `export function ${node.id.name}(${params});\n\n`;
        }
    });

    const dtsName = filePath.replace('.js', '.d.ts');
    fs.writeFileSync(dtsName, output);
    console.log(`Generado: ${dtsName}`);
}

// Ejecución principal
try {
    const files = fs.readdirSync(directoryPath);
    
    files.forEach(file => {
        // Filtro de exclusión y extensión
        if (excludeFiles.includes(file)) return;
        if (path.extname(file) !== '.js') return;

        processFile(path.join(directoryPath, file));
    });
    
    console.log('Proceso completado con éxito.');
} catch (err) {
    console.error('Error al procesar el directorio:', err.message);
}
