const STORAGE_COUNT_KEY = "PR_APPROVAL_COUNTER_NUM_PRS"

// Populate input on load
document.addEventListener('DOMContentLoaded', () => {
  const countInput = document.getElementById('count');

  chrome.storage.local.get([STORAGE_COUNT_KEY], ({ [STORAGE_COUNT_KEY]: prCount }) => {
    countInput.value = prCount || '';
  });

  // Store value on submit
  document.getElementById('submit').addEventListener('click', () => {
    const value = countInput.value;

    if (value > 25) {
      value = 25
    }

    chrome.storage.local.set({ [STORAGE_COUNT_KEY]: value }, () => {
      console.log('Value stored in Chrome storage');
    });
  });
});

