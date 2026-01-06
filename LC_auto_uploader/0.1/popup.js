// Detect current platform
async function detectPlatform() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = tab.url;
  
  if (url.includes('leetcode.com')) return 'leetcode';
  if (url.includes('codeforces.com')) return 'codeforces';
  if (url.includes('codechef.com')) return 'codechef';
  if (url.includes('atcoder.jp')) return 'atcoder';
  return 'unknown';
}

// Update platform badge
async function updatePlatformBadge() {
  const platform = await detectPlatform();
  const badge = document.getElementById('platformBadge');
  const platformNames = {
    'leetcode': 'LeetCode',
    'codeforces': 'Codeforces',
    'codechef': 'CodeChef',
    'atcoder': 'AtCoder',
    'unknown': 'Unknown Platform'
  };
  
  badge.textContent = platformNames[platform];
  badge.className = `platform-badge badge-${platform}`;
}

// Load saved configuration
chrome.storage.sync.get(['githubToken', 'repoName', 'folderPath'], (result) => {
  if (result.githubToken) document.getElementById('githubToken').value = result.githubToken;
  if (result.repoName) document.getElementById('repoName').value = result.repoName;
  if (result.folderPath) document.getElementById('folderPath').value = result.folderPath;
});

// Update badge when popup opens
updatePlatformBadge();

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
  
  const platform = await detectPlatform();
  
  if (platform === 'unknown') {
    showStatus('Unsupported platform. Please open a problem page on LeetCode, Codeforces, CodeChef, or AtCoder', 'error');
    uploadBtn.disabled = false;
    return;
  }
  
  showStatus(`Extracting code from ${platform.charAt(0).toUpperCase() + platform.slice(1)}...`, 'info');
  
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
    
    // Execute content script to extract code based on platform
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      function: extractCodeByPlatform,
      args: [platform]
    });
    
    const problemData = results[0].result;
    console.log(problemData)
    if (!problemData || !problemData.code) {
      showStatus('Could not extract code. Make sure you have code in the editor.', 'error');
      uploadBtn.disabled = false;
      return;
    }
    
    showStatus('Uploading to GitHub...', 'info');
    
    // Upload to GitHub
    await uploadToGitHub(config, problemData, platform);
    
    showStatus('Successfully uploaded to GitHub! ✓', 'success');
    
  } catch (error) {
    showStatus(`Error: ${error.message}`, 'error');
  } finally {
    uploadBtn.disabled = false;
  }
});

// Function that will be injected into the page
function extractCodeByPlatform(platform) {
  const extractors = {
    leetcode: extractLeetCode,
    codeforces: extractCodeforces,
    codechef: extractCodeChef,
    atcoder: extractAtCoder
  };
  console.log("select p")
  return extractors[platform]();
}

function extractLeetCode() {
  try {
    const problemName = window.location.pathname.split('/')[2];
    let code = '';
    let language = 'unknown';
    
    // Try Monaco editor
    try {
      const editorElement = document.querySelector('.monaco-editor');
      if (editorElement && window.monaco) {
        const models = window.monaco.editor.getModels();
        if (models && models.length > 0) {
          code = models[0].getValue();
        }
      }
    } catch (e) {}

    // Fallback to view lines
    if (!code) {
      const editorContent = document.querySelector('.monaco-editor');
      if (editorContent) {
        const lines = editorContent.querySelectorAll('.view-line');
        const codeLines = Array.from(lines).map(line => {
          const spans = line.querySelectorAll('span');
          return Array.from(spans).map(span => span.textContent).join('');
        });
        code = codeLines.join('\n');
      }
    }

    // Get language
    const langButtons = document.querySelectorAll('button');
    for (const button of langButtons) {
      const text = button.textContent.trim();
      if (['Python3', 'Python', 'Java', 'JavaScript', 'C++', 'C', 'C#', 
           'Ruby', 'Swift', 'Go', 'Kotlin', 'Rust', 'TypeScript'].includes(text)) {
        language = text.toLowerCase().replace('python3', 'python');
        break;
      }
    }
    
    // Get problem title
    let problemTitle = problemName;
    const titleElement = document.querySelector('[data-cy="question-title"]') || 
                        document.querySelector('div[class*="text-title"]');
    if (titleElement) {
      problemTitle = titleElement.textContent.trim();
    }
    console.log(code)
    return {
      code: code.trim(),
      language: language,
      problemId: problemName,
      problemTitle: problemTitle,
      url: window.location.href,
      platform: 'leetcode'
    };
  } catch (error) {
    console.log(error)
    return { error: error.message };
  }
}

function extractCodeforces() {
  try {
    // Get problem info from URL
    const urlParts = window.location.pathname.split('/');
    const contestId = urlParts[2];
    const problemLetter = urlParts[4] || '';
    
    // Get code from CodeMirror editor
    let code = '';
    if (window.CodeMirror) {
      const editors = document.querySelectorAll('.CodeMirror');
      if (editors.length > 0) {
        const cmInstance = editors[0].CodeMirror;
        if (cmInstance) {
          code = cmInstance.getValue();
        }
      }
    }
    
    // Fallback to textarea
    if (!code) {
      const textarea = document.querySelector('textarea[name="sourceFile"]') ||
                      document.querySelector('#sourceCodeTextarea');
      if (textarea) {
        code = textarea.value;
      }
    }
    
    // Get language from dropdown
    let language = 'unknown';
    const langSelect = document.querySelector('select[name="programTypeId"]');
    if (langSelect) {
      const selectedOption = langSelect.options[langSelect.selectedIndex];
      language = selectedOption.text.toLowerCase();
    }
    
    // Get problem title
    let problemTitle = `Problem ${problemLetter}`;
    const titleElement = document.querySelector('.problem-statement .title');
    if (titleElement) {
      problemTitle = titleElement.textContent.trim();
    }
    
    return {
      code: code.trim(),
      language: language,
      problemId: `${contestId}${problemLetter}`,
      problemTitle: problemTitle,
      url: window.location.href,
      platform: 'codeforces'
    };
  } catch (error) {
    return { error: error.message };
  }
}

function extractCodeChef() {
  try {
    // Get problem code from URL
    const problemCode = window.location.pathname.split('/')[2];
    
    // Get code from editor
    let code = '';
    
    // Try CodeMirror
    if (window.CodeMirror) {
      const editors = document.querySelectorAll('.CodeMirror');
      if (editors.length > 0) {
        const cmInstance = editors[0].CodeMirror;
        if (cmInstance) {
          code = cmInstance.getValue();
        }
      }
    }
    
    // Try Monaco editor
    if (!code && window.monaco) {
      const models = window.monaco.editor.getModels();
      if (models && models.length > 0) {
        code = models[0].getValue();
      }
    }
    
    // Fallback to textarea
    if (!code) {
      const textarea = document.querySelector('textarea') || 
                      document.querySelector('#editor');
      if (textarea) {
        code = textarea.value;
      }
    }
    
    // Get language
    let language = 'unknown';
    const langSelect = document.querySelector('select[name="language"]') ||
                      document.querySelector('#edit-language');
    if (langSelect) {
      const selectedOption = langSelect.options[langSelect.selectedIndex];
      language = selectedOption.text.toLowerCase();
    }
    
    // Get problem title
    let problemTitle = problemCode;
    const titleElement = document.querySelector('.problem-title') ||
                        document.querySelector('h1');
    if (titleElement) {
      problemTitle = titleElement.textContent.trim();
    }
    
    return {
      code: code.trim(),
      language: language,
      problemId: problemCode,
      problemTitle: problemTitle,
      url: window.location.href,
      platform: 'codechef'
    };
  } catch (error) {
    return { error: error.message };
  }
}

function extractAtCoder() {
  try {
    // Get problem info from URL
    const urlParts = window.location.pathname.split('/');
    const contestId = urlParts[2];
    const problemId = urlParts[4];
    
    // Get code from textarea
    let code = '';
    const textarea = document.querySelector('textarea[name="sourceCode"]') ||
                    document.querySelector('#sourceCode');
    if (textarea) {
      code = textarea.value;
    }
    
    // Try CodeMirror if textarea is empty
    if (!code && window.CodeMirror) {
      const editors = document.querySelectorAll('.CodeMirror');
      if (editors.length > 0) {
        const cmInstance = editors[0].CodeMirror;
        if (cmInstance) {
          code = cmInstance.getValue();
        }
      }
    }
    
    // Get language
    let language = 'unknown';
    const langSelect = document.querySelector('select[name="data.LanguageId"]');
    if (langSelect) {
      const selectedOption = langSelect.options[langSelect.selectedIndex];
      language = selectedOption.text.toLowerCase();
    }
    
    // Get problem title
    let problemTitle = problemId;
    const titleElement = document.querySelector('.h2') ||
                        document.querySelector('span.h2');
    if (titleElement) {
      problemTitle = titleElement.textContent.trim();
    }
    
    return {
      code: code.trim(),
      language: language,
      problemId: `${contestId}_${problemId}`,
      problemTitle: problemTitle,
      url: window.location.href,
      platform: 'atcoder'
    };
  } catch (error) {
    return { error: error.message };
  }
}

async function uploadToGitHub(config, problemData, platform) {
  const { githubToken, repoName, folderPath } = config;
  const { code, language, problemId, problemTitle, url } = problemData;
  
  // Determine file extension
  const extensions = {
    'python': 'py', 'python3': 'py', 'java': 'java',
    'javascript': 'js', 'c++': 'cpp', 'c': 'c',
    'c#': 'cs', 'ruby': 'rb', 'swift': 'swift',
    'go': 'go', 'kotlin': 'kt', 'rust': 'rs',
    'typescript': 'ts'
  };
  
  // Normalize language name
  let normalizedLang = language.toLowerCase();
  for (const key in extensions) {
    if (normalizedLang.includes(key)) {
      normalizedLang = key;
      break;
    }
  }
  
  const extension = extensions[normalizedLang] || 'txt';
  const fileName = `${problemId}.${extension}`;
  const platformFolder = folderPath ? `${folderPath}${platform}/` : `${platform}/`;
  const filePath = `${platformFolder}${fileName}`;
  
  // Extract problem number/identifier for tags
  const problemNumberMatch = problemTitle.match(/^(\d+)\./);
  const problemNumber = problemNumberMatch ? problemNumberMatch[1] : problemId;
  
  // Create file content with header
  const fileContent = `# ${problemTitle}
# ${url}
# Platform: ${platform.charAt(0).toUpperCase() + platform.slice(1)}
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
    // File doesn't exist
  }
  
  // Create commit message with tags
  const platformTag = `#${platform}`;
  const problemTag = `#${problemId.replace(/[^a-zA-Z0-9]/g, '')}`;
  const commitMessage = sha 
    ? `Update solution for ${problemTitle}\n\n${platformTag} ${problemTag}` 
    : `Add solution for ${problemTitle}\n\n${platformTag} ${problemTag}`;
  
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