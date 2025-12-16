```javascript
// File: interactive.js

// Add interactive elements here
``````javascript
// JavaScript functionality to interact with popel images
const popelImages = document.querySelectorAll('.popel-image');

popelImages.forEach(image => {
  image.addEventListener('click', () => {
    alert('Boop! You touched the popel!');
  });
});
```