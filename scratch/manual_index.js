
const { IndexManager } = require('./dist/indexer/indexManager');
const path = require('path');

async function run() {
    const projectPath = "E:\\New folder\\sad\\sadara\\";
    console.log(`Starting manual index for ${projectPath}...`);
    
    // We need to mock the VS Code context or at least the parts IndexManager needs
    const indexManager = new IndexManager();
    
    // IndexManager.indexWorkspace usually takes no args but uses the current workspace
    // We might need to trick it or use a more direct method
    console.log("This requires a full extension context. Trying a direct parse instead...");
}

run();
