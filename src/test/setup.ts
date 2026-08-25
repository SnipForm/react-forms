import '@testing-library/react';

// jsdom has no IntersectionObserver - the hook treats its absence as "no
// visibility signal", which is exactly the branch we want under test.
