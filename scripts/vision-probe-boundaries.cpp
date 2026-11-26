// Bounds only; no model, OCR, product recognition or Android acceptance.
#include "../native/vision.hpp"
#include <iostream>
#include <vector>
#include <string>
#include <stdexcept>
#include <fstream>
#include <iterator>
int main(int argc,char**argv){
 int passed=0;
 auto rejects=[&](const std::vector<unsigned char>&b,const std::string&expected){try{LocalVision::validate_image(b.data(),b.size());throw std::runtime_error("unexpected acceptance");}catch(const std::runtime_error&e){if(e.what()!=expected)throw;}passed++;};
 rejects({},"VISION_IMAGE_SIZE");rejects(std::vector<unsigned char>(2097153,1),"VISION_IMAGE_SIZE");
 rejects({'G','I','F','8','9','a'},"VISION_IMAGE_FORMAT");rejects({255,216,255,192,0},"VISION_IMAGE_FORMAT");
 std::vector<unsigned char> png={137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,0,0,0,0,0,0,0,1};
 rejects(png,"VISION_IMAGE_DIMENSIONS");png[18]=16;png[22]=16;rejects(png,"VISION_IMAGE_DIMENSIONS");
 for(int i=1;i<argc;i++){std::ifstream f(argv[i],std::ios::binary);std::vector<unsigned char>b((std::istreambuf_iterator<char>(f)),{});LocalVision::validate_image(b.data(),b.size());passed++;}
 std::cout<<"PASS image header boundary cases="<<passed<<" (no inference claim)\n";
}
