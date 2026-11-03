(() => {
  const button = document.getElementById('copy');
  const upi = document.getElementById('upi');
  if (!button || !upi) return;
  button.addEventListener('click', async () => {
    const value = upi.textContent.trim();
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(value);
      button.textContent = 'Copied';
    } catch {
      button.textContent = 'Select and copy the UPI ID';
      const range = document.createRange();
      range.selectNodeContents(upi);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    }
  });
})();
