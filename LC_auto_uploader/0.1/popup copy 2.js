// Load saved configuration
chrome.storage.sync.get(['githubToken', 'repoName', 'folderPath'], (result) => {
  if (result.githubToken) document.getElementById('githubToken').value = result.githubToken;
  if (result.repoName) document.getElementById('repoName').value = result.repoName;
  if (result.folderPath) document.getElementById('folderPath').value = result.folderPath;
});

// Save configuration
document.getElementById('saveConfig').addEventListener('click', () => {
  const token = document.getElementById('githubToken').value.trim();
  const repo = document.getElementById('repoName').value.trim();
  const folder = document.getElementById('folderPath').value.trim();
  
  if (!token || !repo) {
    showStatus('Please fill in GitHub token and repository', 'error');
    return;
  }
  
  chrome.storage.sync.set({
    githubToken: token,
    repoName: repo,
    folderPath: folder
  }, () => {
    showStatus('Configuration saved successfully!', 'success');
  });
});

// Upload code to GitHub
document.getElementById('uploadCode').addEventListener('click', async () => {
  const statusDiv = document.getElementById('status');
  const uploadBtn = document.getElementById('uploadCode');
  
  uploadBtn.disabled = true;
  showStatus('Extracting code from LeetCode...', 'info');
  
  try {
    // Get configuration
    const config = await chrome.storage.sync.get(['githubToken', 'repoName', 'folderPath']);
    
    if (!config.githubToken || !config.repoName) {
      showStatus('Please configure GitHub token and repository first', 'error');
      uploadBtn.disabled = false;
      return;
    }
    
    // Get the active tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    if (!tab.url.includes('leetcode.com/problems/')) {
      showStatus('Please open a LeetCode problem page', 'error');
      uploadBtn.disabled = false;
      return;
    }
    
    // Execute content script to extract code
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      function: extractLeetCodeData
    });
    
    const leetcodeData = results[0].result;
    
    if (!leetcodeData || !leetcodeData.code) {
      showStatus('Could not extract code. Make sure you have code in the editor.', 'error');
      uploadBtn.disabled = false;
      return;
    }
    
    showStatus('Uploading to GitHub...', 'info');
    
    // Upload to GitHub
    await uploadToGitHub(config, leetcodeData);
    
    showStatus('Successfully uploaded to GitHub! ✓', 'success');
    
  } catch (error) {
    showStatus(`Error: ${error.message}`, 'error');
  } finally {
    uploadBtn.disabled = false;
  }
});

// Function that will be injected into the page
function extractLeetCodeData() {
  try {
    // Get problem title from URL or page
    const problemName = window.location.pathname.split('/')[2];
    
    let code = '';
    let language = 'unknown';
    
    // Method 1: Try to get code from Monaco editor model
    try {
      // Access Monaco editor instance
      const editorElement = document.querySelector('.monaco-editor');
      if (editorElement && window.monaco) {
        const models = window.monaco.editor.getModels();
        if (models && models.length > 0) {
          code = models[0].getValue();
        }
      }
    } catch (e) {
      console.log('Monaco method failed:', e);
    }
    
    // Method 2: If Monaco fails, try to extract from view lines
    if (!code) {
      const editorContent = document.querySelector('.monaco-editor');
      if (editorContent) {
        const lines = editorContent.querySelectorAll('.view-line');
        const codeLines = Array.from(lines).map(line => {
          // Get text content and preserve spacing
          const spans = line.querySelectorAll('span');
          return Array.from(spans).map(span => span.textContent).join('');
        });
        code = codeLines.join('\n');
      }
    }
    
    // Method 3: Try accessing via React fiber (LeetCode uses React)
    if (!code) {
      try {
        const reactRoot = document.querySelector('[data-cy="code-area"]') || 
                         document.querySelector('.monaco-editor');
        if (reactRoot) {
          const fiberKey = Object.keys(reactRoot).find(key => 
            key.startsWith('__reactFiber') || key.startsWith('__reactInternalInstance')
          );
          if (fiberKey) {
            let fiber = reactRoot[fiberKey];
            // Walk up the fiber tree to find editor state
            while (fiber) {
              if (fiber.memoizedState?.value) {
                code = fiber.memoizedState.value;
                break;
              }
              fiber = fiber.return;
            }
          }
        }
      } catch (e) {
        console.log('React fiber method failed:', e);
      }
    }
    
    // Get selected language from the button
    const langButtons = document.querySelectorAll('button');
    for (const button of langButtons) {
      const text = button.textContent.trim();
      // Check if button contains language names
      if (['Python3', 'Python', 'Java', 'JavaScript', 'C++', 'C', 'C#', 
           'Ruby', 'Swift', 'Go', 'Kotlin', 'Rust', 'TypeScript'].includes(text)) {
        language = text.toLowerCase().replace('python3', 'python');
        break;
      }
    }
    
    // Get problem title from the page
    let problemTitle = problemName;
    const titleElement = document.querySelector('[data-cy="question-title"]') || 
                        document.querySelector('div[class*="text-title"]') ||
                        document.querySelector('a[class*="text-title"]');
    if (titleElement) {
      problemTitle = titleElement.textContent.trim();
    }
    
    // Clean up the code (remove empty lines at start/end)
    code = code.trim();
    
    return {
      code: code,
      language: language,
      problemName: problemName,
      problemTitle: problemTitle,
      url: window.location.href
    };
  } catch (error) {
    return { error: error.message };
  }
}

async function uploadToGitHub(config, leetcodeData) {
  const { githubToken, repoName, folderPath } = config;
  const { code, language, problemName, problemTitle, url } = leetcodeData;
  
  // Determine file extension based on language
  const extensions = {
    'python': 'py',
    'python3': 'py',
    'java': 'java',
    'javascript': 'js',
    'c++': 'cpp',
    'c': 'c',
    'c#': 'cs',
    'ruby': 'rb',
    'swift': 'swift',
    'go': 'go',
    'kotlin': 'kt',
    'rust': 'rs',
    'typescript': 'ts'
  };
  
  const extension = extensions[language] || 'txt';
  const fileName = `${problemName}.${extension}`;
  const filePath = folderPath ? `${folderPath}${fileName}` : fileName;
  
  // Create file content with header
  const fileContent = `# ${problemTitle}
# ${url}
# Language: ${language}

${code}`;
  
  // Encode content to base64
  const encodedContent = btoa(unescape(encodeURIComponent(fileContent)));
  
  // Check if file exists
  const checkUrl = `https://api.github.com/repos/${repoName}/contents/${filePath}`;
  let sha = null;
  
  try {
    const checkResponse = await fetch(checkUrl, {
      headers: {
        'Authorization': `token ${githubToken}`,
        'Accept': 'application/vnd.github.v3+json'
      }
    });
    
    if (checkResponse.ok) {
      const data = await checkResponse.json();
      sha = data.sha;
    }
  } catch (error) {
    // File doesn't exist, which is fine
  }
  
  // Extract problem number from title (e.g., "1. Two Sum" -> "1")
  const problemNumberMatch = problemTitle.match(/^(\d+)\./);
  const problemNumber = problemNumberMatch ? problemNumberMatch[1] : '';
  
  // Create commit message with tags
  const commitMessage = sha 
    ? `Update Leetcode ${problemNumber}: ${problemName} [${language}]` 
    : `Add Leetcode ${problemNumber}: ${problemName} [${language}]`;
  
  // Upload or update file
  const uploadUrl = `https://api.github.com/repos/${repoName}/contents/${filePath}`;
  const payload = {
    message: commitMessage,
    content: encodedContent,
    ...(sha && { sha })
  };
  
  const response = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'Authorization': `token ${githubToken}`,
      'Accept': 'application/vnd.github.v3+json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Failed to upload to GitHub');
  }
  
  return await response.json();
}

function showStatus(message, type) {
  const statusDiv = document.getElementById('status');
  statusDiv.textContent = message;
  statusDiv.className = `status ${type}`;
  statusDiv.style.display = 'block';
  
  if (type === 'success') {
    setTimeout(() => {
      statusDiv.style.display = 'none';
    }, 3000);
  }
}