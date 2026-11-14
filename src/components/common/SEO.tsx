import React, { useEffect } from 'react';

interface SEOProps {
  title: string;
  description: string;
  path?: string;
}

export const SEO: React.FC<SEOProps> = ({ title, description, path = '' }) => {
  useEffect(() => {
    // 1. Document Title
    document.title = title;

    // Helper to safely set meta tag content
    const setMetaTag = (attributeName: string, attributeValue: string, content: string) => {
      let element = document.querySelector(`meta[${attributeName}="${attributeValue}"]`);
      if (!element) {
        element = document.createElement('meta');
        element.setAttribute(attributeName, attributeValue);
        document.head.appendChild(element);
      }
      element.setAttribute('content', content);
    };

    // 2. Meta description
    setMetaTag('name', 'description', description);

    // 3. Open Graph
    setMetaTag('property', 'og:title', title);
    setMetaTag('property', 'og:description', description);
    if (path && typeof window !== 'undefined') {
      const fullUrl = `${window.location.origin}${path}`;
      setMetaTag('property', 'og:url', fullUrl);
    }

    // 4. Twitter Cards
    setMetaTag('name', 'twitter:title', title);
    setMetaTag('name', 'twitter:description', description);
  }, [title, description, path]);

  return null;
};

