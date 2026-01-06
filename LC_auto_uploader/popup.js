// Detect current platform
async function detectPlatform() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url) return "unknown";
  const url = tab.url;

  if (url.includes("leetcode.com")) return "leetcode";
  if (url.includes("codeforces.com")) return "codeforces";
  if (url.includes("codechef.com")) return "codechef";
  if (url.includes("atcoder.jp")) return "atcoder";
  return "unknown";
}

async function updatePlatformBadge() {
  const platform = await detectPlatform();
  const badge = document.getElementById("platformBadge");
  const platformNames = {
    leetcode: "LeetCode",
    codeforces: "Codeforces",
    codechef: "CodeChef",
    atcoder: "AtCoder",
    unknown: "Unknown Platform",
  };
  badge.textContent = platformNames[platform];
  badge.className = `platform-badge badge-${platform}`;
}

// Load saved config
chrome.storage.sync.get(["githubToken", "repoName", "folderPath"], (res) => {
  if (res.githubToken)
    document.getElementById("githubToken").value = res.githubToken;
  if (res.repoName) document.getElementById("repoName").value = res.repoName;
  if (res.folderPath)
    document.getElementById("folderPath").value = res.folderPath;
});

updatePlatformBadge();

document.getElementById("saveConfig").addEventListener("click", () => {
  const token = document.getElementById("githubToken").value.trim();
  const repo = document.getElementById("repoName").value.trim();
  const folder = document.getElementById("folderPath").value.trim();

  if (!token || !repo) {
    showStatus("Token and Repository are required", "error");
    return;
  }

  chrome.storage.sync.set(
    { githubToken: token, repoName: repo, folderPath: folder },
    () => {
      showStatus("Configuration saved!", "success");
    }
  );
});

document.getElementById("uploadCode").addEventListener("click", async () => {
  const uploadBtn = document.getElementById("uploadCode");
  uploadBtn.disabled = true;

  try {
    const platform = await detectPlatform();
    if (platform === "unknown") throw new Error("Unsupported platform");

    const config = await chrome.storage.sync.get([
      "githubToken",
      "repoName",
      "folderPath",
    ]);
    if (!config.githubToken || !config.repoName)
      throw new Error("Configure GitHub settings first");

    showStatus(`Extracting from ${platform}...`, "info");
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });

    // CRITICAL FIX: Running in MAIN world to access page variables like window.monaco
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: "MAIN",
      func: injectedExtractor,
      args: [platform],
    });

    const problemData = results[0].result;
    if (!problemData || problemData.error || !problemData.code) {
      throw new Error(problemData?.error || "No code found in editor");
    }

    showStatus("Uploading to GitHub...", "info");
    await uploadToGitHub(config, problemData, platform);
    showStatus("Uploaded successfully! ✓", "success");
  } catch (error) {
    showStatus(error.message, "error");
  } finally {
    uploadBtn.disabled = false;
  }
});

// This function runs inside the web page context (MAIN world)
function injectedExtractor(platform) {
  try {
    const data = {
      url: window.location.href,
      platform: platform,
      code: "",
      language: "unknown",
      problemId: "",
      problemTitle: "",
    };

    if (platform === "leetcode") {
      if (window.monaco) {
        data.code = window.monaco.editor.getModels()[0]?.getValue();
      }
      data.problemId = window.location.pathname.split("/")[2];
      const titleNode =
        document.querySelector('div[class*="text-title-large"]') ||
        document.querySelector(".mr-2.text-label-1");
      data.problemTitle = titleNode ? titleNode.innerText : data.problemId;
      const langBtn = document.querySelector(
        'button[id*="headlessui-listbox-button"]'
      );
      data.language = langBtn
        ? langBtn.innerText.split("\n")[0].toLowerCase()
        : "unknown";
    } else if (platform === "codeforces") {
      if (window.CodeMirror) {
        const cm = document.querySelector(".CodeMirror")?.CodeMirror;
        data.code = cm ? cm.getValue() : "";
      } else {
        data.code = document.querySelector("#sourceCodeTextarea")?.value || "";
      }
      const parts = window.location.pathname.split("/");
      data.problemId = parts[2] + (parts[4] || "");
      data.problemTitle =
        document.querySelector(".problem-statement .title")?.innerText ||
        "CF Problem";
      data.language =
        document.querySelector('select[name="programTypeId"]')
          ?.selectedOptions[0]?.text || "unknown";
    } else if (platform === "codechef") {
      // 1. Extract Title from the ID 'problem-statement'
      const problemStatement = document.getElementById("problem-statement");
      const titleNode = problemStatement
        ? problemStatement.querySelector("h1, h2, h3")
        : null;
      data.problemTitle = titleNode
        ? titleNode.innerText.trim()
        : document.querySelector("h1")?.innerText.trim() || "CodeChef Problem";

      // 2. Extract Code from Ace Editor lines
      const aceLines = document.querySelectorAll(".ace_line");
      if (aceLines.length > 0) {
        data.code = Array.from(aceLines)
          .map((line) => line.textContent)
          .join("\n");
      }

      // 3. Problem ID from URL
      const pathParts = window.location.pathname.split("/");
      data.problemId =
        pathParts[pathParts.length - 1] || pathParts[pathParts.length - 2];

      // 4. Language from ID 'language-select'
      const langSelector = document.getElementById("language-select");
      if (langSelector) {
        // If it's a standard <select>, get value; if it's a custom div, get text
        data.language =
          langSelector.value || langSelector.innerText.trim().toLowerCase();
      } else {
        // Fallback to general selector if ID isn't found
        data.language =
          document
            .querySelector(".m-select-control")
            ?.innerText.trim()
            .toLowerCase() || "unknown";
      }
    } else if (platform === 'atcoder') {
      // 1. Extract Title from Select2 container
      const titleContainer = document.getElementById('select2-select-task-container');
      data.problemTitle = titleContainer ? titleContainer.innerText.trim() : (document.querySelector('.h2')?.innerText.trim() || 'AtCoder Problem');

      // 2. Extract Code from Ace Editor lines
      const aceLines = document.querySelectorAll('.ace_line');
      if (aceLines.length > 0) {
        data.code = Array.from(aceLines)
          .map(line => line.textContent)
          .join('\n');
      } else {
        // Fallback for non-Ace mode or simple textarea
        data.code = document.querySelector('#sourceCode')?.value || '';
      }

      // 3. Problem ID from URL
      const pathParts = window.location.pathname.split('/');
      data.problemId = pathParts[pathParts.length - 1] || 'problem';

      // 4. Language from Select2 Language container
      // Using a wildcard selector because '1u' in 'select2-dataLanguageId-1u-container' can be dynamic
      const langContainer = document.querySelector('[id^="select2-dataLanguageId-"]');
      if (langContainer) {
        data.language = langContainer.innerText.trim().toLowerCase();
      } else {
        const langSelect = document.querySelector('select[name="data.LanguageId"]');
        data.language = langSelect ? langSelect.selectedOptions[0].text.toLowerCase() : 'unknown';
      }
    }
    return data;
  } catch (e) {
    return { error: e.message };
  }
}
async function uploadToGitHub(config, problemData, platform) {
  const { githubToken, repoName, folderPath } = config;
  const { code, language, problemId, problemTitle, url } = problemData;

  const extensions = {
    python: "py",
    java: "java",
    javascript: "js",
    cpp: "cpp",
    "c++": "cpp",
    rust: "rs",
    go: "go",
  };
  let ext = "txt";
  for (const key in extensions) {
    if (language.toLowerCase().includes(key)) {
      ext = extensions[key];
      break;
    }
  }

  const fileName = `${problemId}.${ext}`;
  const filePath = `${
    folderPath ? folderPath + "/" : ""
  }${platform}/${fileName}`.replace(/\/+/g, "/");

  const fileContent = `/*\n * Problem: ${problemTitle}\n * URL: ${url}\n * Platform: ${platform}\n */\n\n${code}`;
  const encodedContent = btoa(unescape(encodeURIComponent(fileContent)));

  // Check SHA for updates
  let sha = null;
  const apiUrl = `https://api.github.com/repos/${repoName}/contents/${filePath}`;
  const headers = {
    Authorization: `token ${githubToken}`,
    Accept: "application/vnd.github.v3+json",
  };

  try {
    const res = await fetch(apiUrl, { headers });
    if (res.ok) {
      const data = await res.json();
      sha = data.sha;
    }
  } catch (e) {}

  const putRes = await fetch(apiUrl, {
    method: "PUT",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({
      message: `${sha ? "Update" : "Add"} solution: ${problemTitle}`,
      content: encodedContent,
      sha: sha || undefined,
    }),
  });

  if (!putRes.ok) {
    const errorData = await putRes.json();
    throw new Error(errorData.message || "GitHub Upload Failed");
  }
}

function showStatus(message, type) {
  const statusDiv = document.getElementById("status");
  statusDiv.textContent = message;
  statusDiv.className = `status ${type}`;
  statusDiv.style.display = "block";
  if (type === "success")
    setTimeout(() => (statusDiv.style.display = "none"), 3000);
}
