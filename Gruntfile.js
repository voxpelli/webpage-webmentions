'use strict';

module.exports = function (grunt) {
  var indentLines = function (src) {
    return src.split('\n').map(function (line) {
      return line ? '  ' + line : line;
    }).join('\n');
  };

  grunt.initConfig({
    pkg: grunt.file.readJSON('package.json'),
    concat: {
      options: {
        separator: ';'
      },
      web: {
        src: [
          'theme/sources/js/vendor/jquery.js',
          'theme/sources/js/script.js'
        ],
        dest: 'theme/public/js/script.js'
      },
      cuttingEdgeAjax: {
        options: {
          banner: '(function () {\n',
          footer: '\n  window.VPWebMentionEndpoint = publicMethods;\n  findNewInjectionPoints();\n}());\n',
          process: indentLines
        },
        src: ['theme/sources/js/cutting-edge.js'],
        dest: 'theme/public/js/cutting-edge.js'
      }
      // cuttingEdgeTemplate: {
      //   options: {
      //     banner: '(function (mentions, interactions, options) {\n',
      //     footer: '}(\\<%= JSON.stringify(mentions) %\\>, \\<%= JSON.stringify(interactions) %\\>, \\<%= JSON.stringify(options) %\\>));\n',
      //     process: indentLines,
      //   },
      //   src: ['theme/sources/js/cutting-edge.js'],
      //   dest: 'theme/templates/cutting-edge-embed.html'
      // }
    },
    uglify: {
      dist: {
        files: {
          'theme/public/js/script.js': ['theme/public/js/script.js'],
          'theme/public/js/cutting-edge.js': ['theme/public/js/cutting-edge.js']
        }
      }
    }
  });

  grunt.loadNpmTasks('grunt-contrib-concat');
  grunt.loadNpmTasks('grunt-contrib-uglify');

  grunt.registerTask('build-dev', ['concat']);
  grunt.registerTask('build', ['concat', 'uglify']);

  grunt.registerTask('default', ['build-dev']);
};
