import { Link } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import React from 'react';
import { Platform } from 'react-native';

export function ExternalLink(
  props: Omit<React.ComponentProps<typeof Link>, 'href'> & {
    href: React.ComponentProps<typeof Link>['href'];
  }
) {
  return (
    <Link
      target="_blank"
      {...props}
      href={props.href}
      onPress={(e) => {
        props.onPress?.(e);
        if (e.defaultPrevented) return;

        if (Platform.OS !== 'web' && typeof props.href === 'string') {
          // Prevent the default behavior of linking to the default browser on native.
          e.preventDefault();
          // Open the link in an in-app browser.
          WebBrowser.openBrowserAsync(props.href);
        }
      }}
    />
  );
}
