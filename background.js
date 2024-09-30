const STORAGE_COUNT_KEY = "PR_APPROVAL_COUNTER_NUM_PRS"
const STORAGE_PREFIX = "PR_APPROVAL_COUNTER"

// Set storage on install
chrome.runtime.onInstalled.addListener(function(details) {
  if (details.reason == "update") {
    chrome.storage.local.get([STORAGE_COUNT_KEY])
      .then((prCount) => {
        if (!prCount) {
          chrome.storage.local.set({ [STORAGE_COUNT_KEY]: 10 })
            .catch((error) => console.error(error));
        }
      })
  }
});

// listen for github page load
chrome.tabs.onUpdated.addListener(function(_, changeInfo, tab) {
  const { basePath, isPR } = parseURL(tab.url)
  if (changeInfo.status == 'complete' && tab.active && isPR) {

    // get domain
    const url = new URL(basePath)
    const domain = `https://${url.hostname}`

    // get header cooike
    chrome.cookies.getAll(
      { domain, },
      (cookies) => {
        // Create a semicolon-separated string of cookies
        const cookieString = cookies
          .map(cookie => `${cookie.name}=${cookie.value}`)
          .join('; ');

        // fetch
        const myHeaders = new Headers();
        myHeaders.append("cookie", cookieString);

        const requestOptions = {
          method: "GET",
          headers: myHeaders,
          redirect: "follow"
        };

        const storageKey = `${STORAGE_PREFIX}-${basePath}`
        const storageKeyIssues = `${STORAGE_PREFIX}-${basePath}_allIssues`
        const storageKeyReviewed = `${STORAGE_PREFIX}-${basePath}_reviewedIssues`
        var fetchAllPRs, fetchReviewedPRs, outOfDate;
        chrome.storage.local.get([storageKey])
          .then((result) => {
            const storedData = result[storageKey];
            if (storedData && storedData.timestamp) {
              const storedDate = new Date(storedData.timestamp);
              const currentDate = new Date();
              const fiveMinutesInMs = 5 * 60 * 1000;
              outOfDate = (currentDate - storedDate) <= fiveMinutesInMs

              // if in cache and fresh, pull from storage
              if (outOfDate) {
                fetchAllPRs = chrome.storage.local.get([storageKeyIssues])
                  .then((result) => result[storageKeyIssues]);
                fetchReviewedPRs = chrome.storage.local.get([storageKeyReviewed])
                  .then((result) => result[storageKeyReviewed]);
              } else {
                fetchAllPRs = fetch(`${basePath}/pulls?q=is%3Apr+is%3Aclosed+review%3Aapproved`, requestOptions)
                  .then(response => response.text())
                  .then(result => getIssues(result));

                fetchReviewedPRs = fetch(`${basePath}/pulls?q=is%3Apr+is%3Aclosed+reviewed-by%3A%40me`, requestOptions)
                  .then(response => response.text())
                  .then(result => getIssues(result));
              }
            } else {
              fetchAllPRs = fetch(`${basePath}/pulls?q=is%3Apr+is%3Aclosed+review%3Aapproved`, requestOptions)
                .then(response => response.text())
                .then(result => getIssues(result));

              fetchReviewedPRs = fetch(`${basePath}/pulls?q=is%3Apr+is%3Aclosed+reviewed-by%3A%40me`, requestOptions)
                .then(response => response.text())
                .then(result => getIssues(result));
            }

            Promise.all([fetchAllPRs, fetchReviewedPRs])
              .then(([allIssues, reviewedIssues]) => {
                if (!outOfDate) {
                  console.log(`PR Approval Counter: Updating storage for ${basePath}.`)
                  chrome.storage.local.set({ [storageKeyIssues]: allIssues })
                    .catch((error) => console.error(error));
                  chrome.storage.local.set({ [storageKeyReviewed]: reviewedIssues })
                    .catch((error) => console.error(error));
                  chrome.storage.local.set({ [storageKey]: { timestamp: new Date().getTime() } })
                    .catch((error) => console.error(error));
                }
                const result = countOverlappingValues(reviewedIssues, allIssues);
                return updateReviewRequestSection(result, tab.id);
              })
              .catch(error => console.error(error));
          })
          .catch((error) => {
            console.error('Error accessing chrome.storage.local:', error);
          });
      },
    )
  }
});

function updateReviewRequestSection(count, tabId) {
  chrome.storage.local.get([STORAGE_COUNT_KEY])
    .then(({ [STORAGE_COUNT_KEY]: prCount }) => {
      const content = `You've approved <b>${count}</b> of the last <b>${prCount}</b> PRs for this repo.`;
      chrome.scripting.executeScript({
        args: [{ content }],
        target: { tabId },
        func: ({ content }) => {
          const searchText = ["requested your review on this pull request.", "files viewed"];
          const injectedClassName = 'pr-approval-counter-injected';

          // Check if the element has already been injected
          if (document.querySelector(`.${injectedClassName}`)) {
            console.log("PR Approval Counter: Content already injected");
            return;
          }

          const walker = document.createTreeWalker(
            document.body,
            NodeFilter.SHOW_TEXT,
            null,
            false
          );
          let node;
          while (node = walker.nextNode()) {
            if (node.nodeValue.includes(searchText[0]) || node.nodeValue.includes(searchText[1])) {
              let element = node.parentElement;
              if (node.nodeValue.includes(searchText[1])) {
                element = element.parentElement.parentElement.parentElement;
              }
              if (element) {
                const newElement = document.createElement('div');
                newElement.innerHTML = content;
                newElement.className = `${element.className.split(' ').filter(word => !word.toLowerCase().startsWith('flex')).join(' ')} ${injectedClassName}`;
                element.parentNode.insertBefore(newElement, element.nextSibling);
              }
              return;
            }
          }
          console.log("PR Approval Counter: Section not found");
        }
      });
    });
}

function countOverlappingValues(arr1, arr2) {
  const set1 = new Set(arr1);
  const set2 = new Set(arr2);
  let overlapCount = 0;

  for (const item of set2) {
    if (set1.has(item)) {
      overlapCount++;
    }
  }
  return overlapCount;
}

// get number of PRs 
function getIssues(text) {
  return chrome.storage.local.get([STORAGE_COUNT_KEY])
    .then(({ [STORAGE_COUNT_KEY]: prCount }) => {
      // Regular expression to match "issue_" followed by one or more digits
      const issueRegex = /issue_(\d+)/g;

      let match;
      const numbers = [];

      // Continue matching until we have k numbers or we run out of matches
      while ((match = issueRegex.exec(text)) !== null && numbers.length < prCount) {
        numbers.push(parseInt(match[1], 10));
      }

      return numbers;
    })
}

function parseURL(url) {
  try {
    // Parse the URL
    const parsedUrl = new URL(url);

    // Check if it's GitHub.com or a potential GitHub Enterprise URL
    if (!(parsedUrl.hostname === 'github.com' || parsedUrl.hostname.includes('git'))) {
      return { isPR: false };
    }

    // Split the pathname
    const pathParts = parsedUrl.pathname.split('/').filter(Boolean);

    // Check if the URL structure matches a pull request URL
    // The structure should be: /:owner/:repo/pull/:number
    if (pathParts[2].toLowerCase() === 'pull') {
      return { basePath: `https://${parsedUrl.hostname}/${pathParts[0]}/${pathParts[1]}`, isPR: true };
    }

    return { isPR: false };
  } catch (error) {
    // If URL parsing fails, it's not a valid URL
    return { isPR: false };
  }
}
