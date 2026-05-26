import { AndroidParser } from '../src/indexer/androidParser';
import * as assert from 'assert';

function testKotlin() {
  console.log('Testing Kotlin Parsing...');
  const parser = new AndroidParser();
  const content = `
    package com.example.app
    import android.os.Bundle
    import androidx.appcompat.app.AppCompatActivity

    @MyAnnotation
    class MainActivity : AppCompatActivity(), ClickListener {
      private val TAG = "MainActivity"
      var count = 0

      override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        setupView()
      }

      private fun setupView() {
        val btn = findViewById(R.id.btn)
        btn.setOnClickListener {
          count++
          logChange("clicked")
        }
      }
    }
  `;

  const info = parser.parse('MainActivity.kt', content);
  
  // Assertions
  assert.strictEqual(info.filePath, 'MainActivity.kt');
  assert.strictEqual(info.classes.length, 1);
  const cls = info.classes[0];
  assert.strictEqual(cls.name, 'MainActivity');
  assert.strictEqual(cls.extendsClass, 'AppCompatActivity');
  assert.deepStrictEqual(cls.implements, ['ClickListener']);
  
  // Methods
  console.log('Matched Kotlin methods:', cls.methods.map(m => m.name));
  assert.strictEqual(cls.methods.length, 2);
  assert.strictEqual(cls.methods[0].name, 'onCreate');
  assert.strictEqual(cls.methods[1].name, 'setupView');
  
  // Properties
  assert.strictEqual(cls.properties.length, 2);
  assert.strictEqual(cls.properties[0].name, 'TAG');
  assert.strictEqual(cls.properties[1].name, 'count');

  // Imports
  assert.strictEqual(info.imports.length, 2);
  assert.strictEqual(info.imports[0].path, 'android.os.Bundle');

  // Warnings
  assert.ok(info.warnings.some(w => w.type === 'hardcoded_text' && w.message.includes('clicked')));

  console.log('Kotlin Parsing Passed!');
}

function testJava() {
  console.log('Testing Java Parsing...');
  const parser = new AndroidParser();
  const content = `
    package com.example.app;
    import android.os.Bundle;

    public class Helper {
      public static final String KEY = "HelperKey";
      private int state = 1;

      public int getState() {
        return this.state;
      }
    }
  `;

  const info = parser.parse('Helper.java', content);
  assert.strictEqual(info.classes.length, 1);
  const cls = info.classes[0];
  assert.strictEqual(cls.name, 'Helper');
  assert.strictEqual(cls.properties.length, 2);
  assert.strictEqual(cls.properties[0].name, 'KEY');
  assert.strictEqual(cls.properties[1].name, 'state');
  assert.strictEqual(cls.methods.length, 1);
  assert.strictEqual(cls.methods[0].name, 'getState');
  console.log('Java Parsing Passed!');
}

function testXml() {
  console.log('Testing XML Layout Parsing...');
  const parser = new AndroidParser();
  const content = `<?xml version="1.0" encoding="utf-8"?>
    <LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
        android:layout_width="match_parent"
        android:layout_height="match_parent"
        android:orientation="vertical">
        <TextView
            android:id="@+id/title"
            android:layout_width="wrap_content"
            android:layout_height="wrap_content"
            android:text="Hardcoded Welcome Screen"
            android:textColor="#FF0000" />
        <Button
            android:id="@+id/btn"
            android:layout_width="wrap_content"
            android:layout_height="wrap_content"
            android:text="@string/btn_submit" />
    </LinearLayout>
  `;

  const info = parser.parse('res/layout/activity_main.xml', content);
  assert.strictEqual(info.widgets.length, 1);
  const root = info.widgets[0];
  assert.strictEqual(root.name, 'LinearLayout');
  assert.strictEqual(root.children.length, 2);
  assert.strictEqual(root.children[0].name, 'TextView');
  assert.strictEqual(root.children[1].name, 'Button');

  // Hardcoded check
  assert.ok(info.warnings.some(w => w.type === 'hardcoded_text' && w.message.includes('Welcome')));
  assert.ok(info.warnings.some(w => w.type === 'hardcoded_color' && w.message.includes('#FF0000')));
  // Submit should NOT be warned because it uses @string/
  assert.ok(!info.warnings.some(w => w.message.includes('btn_submit')));

  console.log('XML Layout Parsing Passed!');
}

function testXmlResources() {
  console.log('Testing XML Resources Parsing...');
  const parser = new AndroidParser();
  const content = `<?xml version="1.0" encoding="utf-8"?>
    <resources>
        <string name="app_name">My App</string>
        <color name="primaryColor">#FF00FF</color>
    </resources>
  `;
  const info = parser.parse('res/values/strings.xml', content);
  assert.strictEqual(info.variables.length, 2);
  assert.strictEqual(info.variables[0].name, 'app_name');
  assert.strictEqual(info.variables[0].value, 'My App');
  assert.strictEqual(info.variables[1].name, 'primaryColor');
  assert.strictEqual(info.variables[1].value, '#FF00FF');
  console.log('XML Resources Parsing Passed!');
}

function testGradle() {
  console.log('Testing Gradle Parsing...');
  const parser = new AndroidParser();
  const content = `
    plugins {
        id 'com.android.application'
    }
    android {
        compileSdk 34
        defaultConfig {
            applicationId "com.example.app"
            minSdk 21
            targetSdk 34
            versionCode 1
            versionName "1.0.0"
        }
    }
    dependencies {
        implementation 'androidx.core:core-ktx:1.12.0'
        implementation libs.androidx.appcompat
    }
  `;
  const info = parser.parse('build.gradle', content);
  
  // Dependencies
  assert.strictEqual(info.imports.length, 2);
  assert.strictEqual(info.imports[0].path, 'androidx.core:core-ktx:1.12.0');
  assert.strictEqual(info.imports[1].path, 'libs.androidx.appcompat');

  // Config variables
  assert.strictEqual(info.variables.length, 6);
  assert.strictEqual(info.variables.find(v => v.name === 'compileSdk')?.value, '34');
  assert.strictEqual(info.variables.find(v => v.name === 'minSdk')?.value, '21');
  assert.strictEqual(info.variables.find(v => v.name === 'applicationId')?.value, 'com.example.app');
  assert.strictEqual(info.variables.find(v => v.name === 'versionName')?.value, '1.0.0');

  console.log('Gradle Parsing Passed!');
}

function runAll() {
  try {
    testKotlin();
    testJava();
    testXml();
    testXmlResources();
    testGradle();
    console.log('====================================');
    console.log('All AndroidParser Tests Passed successfully! 🎉');
    console.log('====================================');
  } catch (err) {
    console.error('Test validation failed:', err);
    process.exit(1);
  }
}

runAll();
