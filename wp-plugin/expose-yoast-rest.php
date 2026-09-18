<?php

/**
 * Plugin Name: Expose Yoast SEO Fields to REST API
 * Description: Yoast doesn't register its own postmeta keys with
 * show_in_rest, so they're invisible to /wp-json/wp/v2/<type> requests
 * by default - confirmed on this site via GET ?context=edit, which
 * returned no _yoast_wpseo_* keys in `meta` even on a post with real
 * Yoast values set. This registers the specific keys needed for the
 * case-study import so they become readable AND writable through the
 * standard `meta` object on create/update requests.
 */

add_action('init', function () {
  $post_type = 'work';

  // Belt-and-suspenders: registered meta only shows in REST if the
  // post type declares 'custom-fields' support - add it defensively
  // in case it isn't already there.
  add_post_type_support($post_type, 'custom-fields');

  $string_fields = [
    '_yoast_wpseo_title',
    '_yoast_wpseo_metadesc',
    '_yoast_wpseo_focuskw',
  ];

  foreach ($string_fields as $key) {
    register_post_meta($post_type, $key, [
      'show_in_rest' => true,
      'single'       => true,
      'type'         => 'string',
      'auth_callback' => function () {
        return current_user_can('edit_posts');
      },
    ]);
  }

  // Secondary Keyphrases is a Yoast PREMIUM field. Its real storage key
  // and shape haven't been confirmed on this site yet (nothing showed
  // up under that name in the ?context=edit check either - it may not
  // even be _yoast_wpseo_focuskeywords on this Yoast version). This is
  // registered as a plain string as a first attempt so it's at least
  // visible in `meta` for inspection - if Yoast's real key/shape turns
  // out to be different, update the key name here to match.
  register_post_meta($post_type, '_yoast_wpseo_focuskeywords', [
    'show_in_rest' => true,
    'single'       => true,
    'type'         => 'string',
    'auth_callback' => function () {
      return current_user_can('edit_posts');
    },
  ]);
});
