const test=require('node:test'),assert=require('node:assert/strict');
for(const file of ['../story-text.js']){
 const helper=require(file);
 test(file+' extracts body wrappers and excludes side panels before looking for body',()=>{
  const result=helper.extractStory('<thinking>secret</thinking><status><content>wrong nested</content></status><content>第一段。\n\n第二段。</content><details><summary>小剧场</summary>不要导入</details>');
  assert.equal(result.text,'第一段。\n\n第二段。');assert.equal(result.mode,'tagged');assert.equal(result.tag,'content');
 });
 test(file+' recognizes explicit aliases and custom tags, preserving ordinary prose',()=>{
  for(const tag of ['maintext','main_text','正文','正文内容','story','storytext','narrative'])assert.equal(helper.extractStory('<'+tag+'>正文</'+tag+'><status>noise</status>').text,'正文');
  assert.equal(helper.extractStory('<my-body>custom</my-body><content>other</content>',{bodyTags:'my-body'}).text,'custom');
  assert.equal(helper.extractStory('这是一段没有标签的剧情。').mode,'plain');
  assert.equal(helper.extractStory('<div>普通排版剧情。</div>').text,'普通排版剧情。');
 });
 test(file+' does not leak malformed wrappers, fenced code or nested side content',()=>{
  assert.equal(helper.extractStory('<content>未闭合正文<status>状态</status>').mode,'malformed');
  assert.equal(helper.extractStory('<content>未闭合正文<status>状态</status>').text,'');
  assert.equal(helper.extractStory('```html\n<content>代码示例</content>\n```\n<content>真实剧情<small_theater>小剧场</small_theater></content>').text,'真实剧情');
  assert.equal(helper.extractStory('<content><div>正文</div><content>继续</content></content>').text,'正文\n继续');
  assert.equal(helper.extractStory('<content>[UIBOARD|003|状态栏]\n真实正文。</content>').text,'真实正文。');
 });
}
